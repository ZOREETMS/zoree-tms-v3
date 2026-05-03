-- ============================================================
-- Migration: Fusion ↔ TMS integration (via OIC)
-- Description: Adds external-key columns on existing tables and
--              two new tables (integration_event_log, integration_watermark)
--              to support inbound + outbound integration with Oracle Fusion
--              brokered by Oracle Integration Cloud.
-- Date: 2026-05-02
-- Affected: orders, shipments, items, locations, carriers (additive only),
--           plus new audit + watermark tables.
-- Rollback: see commented block at bottom (lower envs only — see DB rules).
-- See: docs/integrations/oic/02-data-model-changes.md for the full 8-item checklist.
-- ============================================================

-- 1) Orders: source-of-truth pointers to Fusion
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fusion_so_header_id        TEXT,
  ADD COLUMN IF NOT EXISTS fusion_shipment_request_id TEXT,
  ADD COLUMN IF NOT EXISTS fusion_business_unit_id    TEXT;

COMMENT ON COLUMN orders.fusion_so_header_id        IS 'Fusion OM HeaderId for the SO that produced this order.';
COMMENT ON COLUMN orders.fusion_shipment_request_id IS 'Fusion DOO ShipmentRequestId, when the source is a shipment request rather than the SO header.';
COMMENT ON COLUMN orders.fusion_business_unit_id    IS 'Fusion BusinessUnit id; used by OIC to map -> TMS tenant_id.';

-- Lookup index to support upsert-on-fusion-id from the ingest service.
-- Partial: nullable column, only relevant rows participate.
CREATE INDEX IF NOT EXISTS idx_orders_fusion_so_header_id
  ON orders (fusion_so_header_id)
  WHERE fusion_so_header_id IS NOT NULL;

-- 2) Shipments: Fusion-side shipment id (set by F3 once OIC has pushed status)
ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS fusion_shipment_id TEXT;

COMMENT ON COLUMN shipments.fusion_shipment_id IS 'Fusion-side shipment id assigned after F3 outbound publish.';

-- 3) Items: per-tenant Fusion mapping
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS fusion_item_id         TEXT,
  ADD COLUMN IF NOT EXISTS fusion_organization_id TEXT;

COMMENT ON COLUMN items.fusion_item_id         IS 'Fusion ItemId for the item master record.';
COMMENT ON COLUMN items.fusion_organization_id IS 'Fusion OrganizationId the item is mastered in.';

-- Uniqueness within this Supabase project (multi-tenancy in this repo is
-- per-Supabase-project, not row-level). Partial: only enforce when set.
CREATE UNIQUE INDEX IF NOT EXISTS ux_items_fusion_item
  ON items (fusion_item_id)
  WHERE fusion_item_id IS NOT NULL;

-- 4) Locations: Fusion organization mapping
ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS fusion_location_id       TEXT,
  ADD COLUMN IF NOT EXISTS fusion_organization_code TEXT;

COMMENT ON COLUMN locations.fusion_location_id       IS 'Fusion OrganizationId (master inventory org).';
COMMENT ON COLUMN locations.fusion_organization_code IS 'Human-readable Fusion org code (e.g. M1).';

CREATE UNIQUE INDEX IF NOT EXISTS ux_locations_fusion_location
  ON locations (fusion_location_id)
  WHERE fusion_location_id IS NOT NULL;

-- 5) Carriers: Fusion mapping (carriers are global today)
ALTER TABLE carriers
  ADD COLUMN IF NOT EXISTS fusion_carrier_id TEXT;

COMMENT ON COLUMN carriers.fusion_carrier_id IS 'Fusion CarrierId; used by F3 to round-trip carrier name to Fusion.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_carriers_fusion_carrier
  ON carriers (fusion_carrier_id)
  WHERE fusion_carrier_id IS NOT NULL;

-- ============================================================
-- 6) Integration audit ledger
-- One row per OIC instance (idempotent on (source, oic_instance_id)).
-- Stores the raw payload so replay is a single SELECT + service call away.
-- ============================================================

CREATE TABLE IF NOT EXISTS integration_event_log (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT        NOT NULL,        -- 'fusion'
  object_type     TEXT        NOT NULL,        -- 'sales_order' | 'shipment_request' | 'inventory_txn' | 'on_hand_snapshot' | 'item' | 'location' | 'carrier' | 'shipment_status' | 'pod'
  direction       TEXT        NOT NULL,        -- 'inbound' | 'outbound'
  external_id     TEXT,                        -- Fusion-side natural key
  internal_id     TEXT,                        -- TMS id once resolved
  oic_instance_id TEXT,                        -- OIC instance/tracking id
  status          TEXT        NOT NULL DEFAULT 'received', -- 'received' | 'processed' | 'failed_4xx' | 'failed_5xx' | 'replayed'
  error           TEXT,
  payload         JSONB       NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ,
  tenant_id       TEXT
);

COMMENT ON TABLE integration_event_log IS 'Ledger of every OIC <-> TMS message. Idempotency + replay surface.';
COMMENT ON COLUMN integration_event_log.oic_instance_id IS 'OIC tracking id; UNIQUE per source so retries are no-ops.';

-- Partial unique: oic_instance_id may be null on outbound rows that haven't been
-- handed off yet. Only enforce uniqueness on rows that have one.
CREATE UNIQUE INDEX IF NOT EXISTS ux_iel_source_oic_instance
  ON integration_event_log (source, oic_instance_id)
  WHERE oic_instance_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_iel_external
  ON integration_event_log (source, object_type, external_id);

CREATE INDEX IF NOT EXISTS idx_iel_status
  ON integration_event_log (status, received_at DESC);

-- ============================================================
-- 7) Integration watermark
-- Stores the per-(source, object_type) cursor used by scheduled
-- delta sweeps. One row per object; updated_at is the audit field.
-- ============================================================

CREATE TABLE IF NOT EXISTS integration_watermark (
  source       TEXT NOT NULL,
  object_type  TEXT NOT NULL,
  cursor_value TIMESTAMPTZ,
  cursor_token TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source, object_type)
);

COMMENT ON TABLE integration_watermark IS 'Per (source, object_type) delta-sweep cursor. Updated by OIC on each successful sweep.';

-- ============================================================
-- ROLLBACK (lower envs only — DB rules forbid auto-rollback in prod)
-- ============================================================
-- DROP TABLE IF EXISTS integration_watermark;
-- DROP TABLE IF EXISTS integration_event_log;
-- ALTER TABLE orders     DROP COLUMN IF EXISTS fusion_so_header_id;
-- ALTER TABLE orders     DROP COLUMN IF EXISTS fusion_shipment_request_id;
-- ALTER TABLE orders     DROP COLUMN IF EXISTS fusion_business_unit_id;
-- ALTER TABLE shipments  DROP COLUMN IF EXISTS fusion_shipment_id;
-- ALTER TABLE items      DROP COLUMN IF EXISTS fusion_item_id;
-- ALTER TABLE items      DROP COLUMN IF EXISTS fusion_organization_id;
-- ALTER TABLE locations  DROP COLUMN IF EXISTS fusion_location_id;
-- ALTER TABLE locations  DROP COLUMN IF EXISTS fusion_organization_code;
-- ALTER TABLE carriers   DROP COLUMN IF EXISTS fusion_carrier_id;
