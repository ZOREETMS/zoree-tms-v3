-- ============================================================
-- Migration: Fusion ↔ TMS integration — DB-rule compliance pass
-- Description: Follow-up to 20260502_fusion_integration.sql. Brings
--              the integration tables in line with zoree_db_rules.pdf:
--                - controlled values via CHECK constraints
--                  (Data Integrity rule 4)
--                - audit fields on every table (Schema rule 5)
--                - documenting comments on JSON / polymorphic columns
--                  (Schema rules 1 & 3)
-- Date: 2026-05-02
-- Affected: integration_event_log, integration_watermark only.
--           No business tables (orders/shipments/items/etc) touched.
-- Rollback: see commented block at bottom.
-- ============================================================

-- 1) Audit field gaps
ALTER TABLE integration_event_log
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE integration_watermark
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMENT ON COLUMN integration_event_log.updated_at IS 'Last touched (insert or status flip). Schema rule 5.';
COMMENT ON COLUMN integration_watermark.created_at IS 'When this (source, object_type) cursor row was first written. Schema rule 5.';

-- 2) Controlled values via CHECK constraints (Data Integrity rule 4).
-- Each constraint is named and added with NOT VALID first, then
-- VALIDATED — this is the deployment-safe path for tables that may
-- already contain rows: adding NOT VALID does not require a full
-- table scan and can never block writes; the VALIDATE pass scans
-- existing rows but does not block writes either.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'integration_event_log_source_chk'
  ) THEN
    ALTER TABLE integration_event_log
      ADD CONSTRAINT integration_event_log_source_chk
      CHECK (source IN ('fusion','oms')) NOT VALID;
    ALTER TABLE integration_event_log VALIDATE CONSTRAINT integration_event_log_source_chk;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'integration_event_log_direction_chk'
  ) THEN
    ALTER TABLE integration_event_log
      ADD CONSTRAINT integration_event_log_direction_chk
      CHECK (direction IN ('inbound','outbound')) NOT VALID;
    ALTER TABLE integration_event_log VALIDATE CONSTRAINT integration_event_log_direction_chk;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'integration_event_log_status_chk'
  ) THEN
    ALTER TABLE integration_event_log
      ADD CONSTRAINT integration_event_log_status_chk
      CHECK (status IN ('received','processed','failed_4xx','failed_5xx','replayed')) NOT VALID;
    ALTER TABLE integration_event_log VALIDATE CONSTRAINT integration_event_log_status_chk;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'integration_event_log_object_type_chk'
  ) THEN
    ALTER TABLE integration_event_log
      ADD CONSTRAINT integration_event_log_object_type_chk
      CHECK (object_type IN (
        'sales_order','shipment_request','inventory_txn','on_hand_snapshot',
        'item','location','carrier','shipment_status','pod','freight_invoice'
      )) NOT VALID;
    ALTER TABLE integration_event_log VALIDATE CONSTRAINT integration_event_log_object_type_chk;
  END IF;
END $$;

-- 3) Document the two intentional shape decisions so future readers
-- don't re-litigate them.

-- payload as JSONB: justified denormalization (Schema rule 3).
COMMENT ON COLUMN integration_event_log.payload IS
  'Raw inbound (or about-to-be-sent outbound) wire payload, kept verbatim '
  'for replay. JSONB is justified denormalization here per zoree_db_rules.pdf '
  'Schema rule 3: the payload shape is polymorphic (varies by object_type) '
  'and intentionally immutable — extracting it into typed columns would '
  'couple the audit ledger to whatever the source system happens to send today.';

-- internal_id has no FK: polymorphic pointer (Schema rule 1 carve-out).
COMMENT ON COLUMN integration_event_log.internal_id IS
  'TMS-side id once resolved (orders.id | shipments.id | items.id | locations.id '
  '| carriers.id depending on object_type). Intentionally NOT a FK — Postgres '
  'does not support polymorphic foreign keys, and a hard FK would block writes '
  'when the audit row is for a poison message that never resolved to a TMS row. '
  'Lookups are via (source, object_type, external_id) instead.';

-- ============================================================
-- ROLLBACK (lower envs only)
-- ============================================================
-- ALTER TABLE integration_event_log  DROP CONSTRAINT IF EXISTS integration_event_log_source_chk;
-- ALTER TABLE integration_event_log  DROP CONSTRAINT IF EXISTS integration_event_log_direction_chk;
-- ALTER TABLE integration_event_log  DROP CONSTRAINT IF EXISTS integration_event_log_status_chk;
-- ALTER TABLE integration_event_log  DROP CONSTRAINT IF EXISTS integration_event_log_object_type_chk;
-- ALTER TABLE integration_event_log  DROP COLUMN IF EXISTS updated_at;
-- ALTER TABLE integration_watermark  DROP COLUMN IF EXISTS created_at;
