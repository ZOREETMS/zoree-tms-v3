-- ============================================================
-- Migration: Messaging Hub — persistent message_log + lookup tables
--
-- Purpose: Persist every OMS ↔ TMS ↔ Carrier message hop so the
-- Messaging Hub UI can stop running on synthetic seed data and become
-- the system of record for the 6-message lifecycle:
--
--   1. OMS → TMS  order_creation       (inbound)
--   2. TMS → CRR  shipment_tender      (outbound)
--   3. CRR → TMS  tender_response      (inbound)
--   4. TMS → OMS  shipment_details     (outbound)
--   5. OMS → TMS  ship_confirmation    (inbound)
--   6. TMS → OMS  delivered            (outbound)
--
-- Date: 2026-05-08
-- Owner: TMS Platform
-- Related: docs/messaging-hub/plan.md
--
-- Design notes:
--   - Mirrors the inbound/outbound shape of `integration_event_log`
--     (Fusion ledger) but lives in its own table because the Messaging
--     Hub captures OMS + Carrier traffic, not Fusion.  We do NOT
--     generalize integration_event_log because that would require
--     renaming `oic_instance_id` and `source` — forbidden by
--     `docs/zoree_db_rules.pdf` §Migration 2 (no rename without safe
--     transition).  The reader UNIONs both at query time.
--   - Lookup tables are preferred over Postgres ENUM so adding a new
--     code is an INSERT, not an ALTER TYPE (forward-compatible).
--   - Audit fields (created_at, updated_at) per
--     `docs/zoree_db_rules.pdf` §Schema Design 5.
--   - Multi-tenant isolation via tenant_id NOT NULL DEFAULT
--     (`docs/zoree_db_rules.pdf` §Schema Design 4).
--
-- Rollback: see commented block at bottom (lower envs only — DB rules
-- forbid auto-rollback in prod).  Operational rollback in prod is the
-- feature flag MESSAGING_HUB_PERSIST=false; the table stays in place.
--
-- Affected APIs/services/UI:
--   - api/services/messagingHub/{writer,reader,correlate,types}.js  (new)
--   - api/services/tendering/{tenderOut,tenderIn}.js                (new)
--   - api/services/omsSync.js                                       (edit)
--   - api/services/shipConfirm.js                                   (edit)
--   - api/routes/messagingHub.js, tendering.js                      (new)
--   - api/routes/ingest.js                                          (edit)
--   - frontend Messaging Hub page                                   (feed swap)
-- ============================================================

-- ============================================================
-- 1) Lookup tables — controlled values
-- ============================================================

CREATE TABLE IF NOT EXISTS message_type_lookup (
  code        TEXT PRIMARY KEY,
  label       TEXT        NOT NULL,
  edge        TEXT        NOT NULL,             -- 'OMS_TMS' | 'TMS_CARRIER' | 'OTHER'
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE message_type_lookup IS
  'Catalog of message types accepted by the Messaging Hub. Lookup (not ENUM) so adding a code is an INSERT.';

CREATE TABLE IF NOT EXISTS system_party_lookup (
  code        TEXT PRIMARY KEY,                 -- 'OMS' | 'TMS' | 'CARRIER' | future…
  label       TEXT        NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE system_party_lookup IS
  'Catalog of systems that can appear as source/target on a message_log row.';

CREATE TABLE IF NOT EXISTS message_status_lookup (
  code        TEXT PRIMARY KEY,                 -- pending|sent|delivered|acknowledged|received|failed|replayed
  label       TEXT        NOT NULL,
  terminal    BOOLEAN     NOT NULL DEFAULT FALSE,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE message_status_lookup IS
  'Catalog of message lifecycle statuses. terminal=true means no further state transition expected.';

-- ============================================================
-- 2) Seed lookup data
-- ============================================================

INSERT INTO system_party_lookup (code, label, description) VALUES
  ('OMS',     'OMS',     'Order Management System'),
  ('TMS',     'TMS',     'Transportation Management System (this app)'),
  ('CARRIER', 'Carrier', 'Carrier integration partner')
ON CONFLICT (code) DO NOTHING;

INSERT INTO message_status_lookup (code, label, terminal, description) VALUES
  ('pending',      'Pending',      FALSE, 'Outbound — queued, not yet sent'),
  ('sent',         'Sent',         FALSE, 'Outbound — handed to transport, no ack yet'),
  ('delivered',    'Delivered',    TRUE,  'Outbound — confirmed delivered to target'),
  ('acknowledged', 'Acknowledged', TRUE,  'Outbound — target replied with positive ack'),
  ('received',     'Received',     FALSE, 'Inbound — captured, processing pending'),
  ('processed',    'Processed',    TRUE,  'Inbound — captured AND business logic ran successfully'),
  ('failed',       'Failed',       FALSE, 'Either direction — last attempt failed; retry candidate'),
  ('replayed',     'Replayed',     TRUE,  'Operator manually re-ran the original message')
ON CONFLICT (code) DO NOTHING;

-- The 6 lifecycle types come first; the existing UI enum codes from
-- `frontend/src/types/messaging.js` are seeded too so legacy compose
-- payloads also persist cleanly.
INSERT INTO message_type_lookup (code, label, edge, description) VALUES
  -- 6-hop lifecycle (REQ — Messaging Hub plan §1)
  ('ORDER_CREATION',    'Order Creation',     'OMS_TMS',     'OMS → TMS new order'),
  ('SHIPMENT_TENDER',   'Shipment Tender',    'TMS_CARRIER', 'TMS → Carrier tender offer'),
  ('TENDER_RESPONSE',   'Tender Response',    'TMS_CARRIER', 'Carrier → TMS accept / decline'),
  ('SHIPMENT_DETAILS',  'Shipment Details',   'OMS_TMS',     'TMS → OMS post-tender shipment details'),
  ('SHIP_CONFIRMATION', 'Ship Confirmation',  'OMS_TMS',     'OMS → TMS warehouse ship-out notification'),
  ('DELIVERED',         'Delivered',          'OMS_TMS',     'TMS → OMS delivery confirmation'),
  -- Legacy / supplementary types already used by the UI compose modal
  ('TENDER_OFFER',      'Tender Offer',       'TMS_CARRIER', 'Legacy alias for SHIPMENT_TENDER (UI compose)'),
  ('SHIPMENT_CREATE',   'Shipment Create',    'OTHER',       'Generic shipment-create message (WMS, etc.)'),
  ('SHIPMENT_UPDATE',   'Shipment Update',    'OTHER',       'Generic shipment-update message'),
  ('SHIPMENT_STATUS',   'Shipment Status',    'OTHER',       'Generic shipment-status message'),
  ('WMS_SYNC',          'WMS Sync',           'OTHER',       'WMS inventory sync'),
  ('DOCK_APPT',         'Dock Appointment',   'OTHER',       'Dock appointment request'),
  ('EVENT_NOTIFICATION','Event Notification', 'OTHER',       'Generic event notification'),
  ('RATE_REQUEST',      'Rate Request',       'OTHER',       'Outbound rate request'),
  ('RATE_RESPONSE',     'Rate Response',      'OTHER',       'Inbound rate response'),
  ('BOL_TRANSMIT',      'BOL Transmit',       'OTHER',       'Bill-of-Lading transmission'),
  ('INVOICE',           'Invoice',            'OTHER',       'Freight invoice')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 3) message_log — main ledger (one row per hop)
-- ============================================================

CREATE TABLE IF NOT EXISTS message_log (
  id              BIGSERIAL    PRIMARY KEY,

  -- What it is
  message_type    TEXT         NOT NULL REFERENCES message_type_lookup(code)   ON UPDATE CASCADE ON DELETE RESTRICT,
  direction       TEXT         NOT NULL,
  source_system   TEXT         NOT NULL REFERENCES system_party_lookup(code)   ON UPDATE CASCADE ON DELETE RESTRICT,
  target_system   TEXT         NOT NULL REFERENCES system_party_lookup(code)   ON UPDATE CASCADE ON DELETE RESTRICT,

  -- Correlation / linkage
  correlation_id  TEXT,                                  -- caller-supplied tracking key (idempotency)
  order_id        TEXT,                                  -- soft FK to orders.id (string id in this repo)
  shipment_id     TEXT,                                  -- soft FK to shipments.id
  external_ref    TEXT,                                  -- OMS order #, carrier load #, etc.

  -- Lifecycle
  status          TEXT         NOT NULL DEFAULT 'received'
                  REFERENCES message_status_lookup(code) ON UPDATE CASCADE ON DELETE RESTRICT,
  attempt_count   INTEGER      NOT NULL DEFAULT 0,
  last_error      TEXT,

  -- Body
  payload         JSONB        NOT NULL,
  headers         JSONB,
  actor           TEXT,                                  -- user.email or service id

  -- Multi-tenant
  tenant_id       TEXT         NOT NULL DEFAULT 'zoree-default',

  -- Audit (per zoree_db_rules.pdf §Schema Design 5)
  received_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- DB-level validation (per zoree_db_rules.pdf §Data Integrity 1)
  CONSTRAINT message_log_direction_chk
    CHECK (direction IN ('inbound', 'outbound')),
  CONSTRAINT message_log_attempts_chk
    CHECK (attempt_count >= 0)
);

COMMENT ON TABLE  message_log IS
  'Persistent ledger for the Messaging Hub. One row per OMS↔TMS↔Carrier message hop. Single writer: api/services/messagingHub/writer.js.';
COMMENT ON COLUMN message_log.correlation_id IS
  'Idempotency / linkage key supplied by caller. Outbound TENDER and inbound TENDER_RESPONSE share one correlation_id.';
COMMENT ON COLUMN message_log.order_id IS
  'Soft FK to orders.id. Nullable: not every message references an order at write time (e.g. unmatched carrier responses pending triage).';
COMMENT ON COLUMN message_log.payload IS
  'Raw inbound or outbound message body. JSONB is justified here per zoree_db_rules.pdf §Schema Design 3 because the body is itself a polymorphic message envelope, not relational data.';

-- ============================================================
-- 4) Indexes — query patterns first (zoree_db_rules.pdf §Performance 1)
-- ============================================================

-- Idempotency on (source_system, correlation_id). Partial: only enforce
-- when correlation_id is supplied; outbound rows without a correlation
-- key are still allowed.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ml_source_correlation
  ON message_log (source_system, correlation_id)
  WHERE correlation_id IS NOT NULL;

-- Ops query: "failed in last 24h" (Hub UI Failed tab + alerting).
CREATE INDEX IF NOT EXISTS idx_ml_status_received
  ON message_log (status, received_at DESC);

-- Order timeline view (drill-down from an order to all its messages).
CREATE INDEX IF NOT EXISTS idx_ml_order
  ON message_log (order_id)
  WHERE order_id IS NOT NULL;

-- Shipment timeline view (drill-down from a shipment to all its messages).
CREATE INDEX IF NOT EXISTS idx_ml_shipment
  ON message_log (shipment_id)
  WHERE shipment_id IS NOT NULL;

-- Hub list filters: "show me Outbound TENDER messages newest first".
CREATE INDEX IF NOT EXISTS idx_ml_type_dir_received
  ON message_log (message_type, direction, received_at DESC);

-- Tenant scoping for the multi-tenant Hub query path.
CREATE INDEX IF NOT EXISTS idx_ml_tenant_received
  ON message_log (tenant_id, received_at DESC);

-- ============================================================
-- 5) updated_at trigger — keep audit field honest without app-side help
-- ============================================================

CREATE OR REPLACE FUNCTION message_log_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS message_log_updated_at_trg ON message_log;
CREATE TRIGGER message_log_updated_at_trg
  BEFORE UPDATE ON message_log
  FOR EACH ROW
  EXECUTE FUNCTION message_log_set_updated_at();

-- ============================================================
-- ROLLBACK (lower envs only — DB rules forbid auto-rollback in prod)
-- Production rollback path: set MESSAGING_HUB_PERSIST=false in env.
-- ============================================================
-- DROP TRIGGER  IF EXISTS message_log_updated_at_trg ON message_log;
-- DROP FUNCTION IF EXISTS message_log_set_updated_at();
-- DROP TABLE    IF EXISTS message_log;
-- DROP TABLE    IF EXISTS message_status_lookup;
-- DROP TABLE    IF EXISTS system_party_lookup;
-- DROP TABLE    IF EXISTS message_type_lookup;
