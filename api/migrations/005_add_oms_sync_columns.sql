-- Migration: 005_add_oms_sync_columns
-- Date: 2026-04-16
-- Author: Claude (AI-assisted)
-- Description: REQ-01 Auto order sync OMS to TMS.
--              Adds audit columns to the orders table so that orders received
--              from the OMS via middleware can be distinguished from
--              manually-entered orders and so that auto-sync timing can be
--              measured for SLA reporting. This enables the TMS UI to show
--              "auto-synced" orders separately, and enables downstream
--              reports (e.g. REQ-05 bulk planning perf) to join against sync
--              timing.
--
-- Affected APIs/UI:
--   api/routes/ingest.js (NEW)        — /api/ingest/oms-orders sets sync_source='oms'
--   api/services/orderIngest.js (NEW) — handles inbound OMS payload
--   api/server.js                     — mounts the new ingest router + SSE broadcast
--   frontend/src/services/ordersService.js — subscribeOrderChanges() reads columns
--   frontend/src/pages/OrdersPage.jsx      — shows sync badge on auto-synced rows
--
-- Backfill:
--   Existing orders are assumed manual. Default sync_source='manual' is applied
--   via DEFAULT clause. No explicit UPDATE needed.
--
-- Index changes:
--   + idx_orders_sync_source  — supports filtered queries ("show only OMS-synced")
--   + idx_orders_auto_synced_at — supports ORDER BY for "recently synced" lists
--
-- Constraint changes:
--   + CHECK (sync_source IN ('manual','oms','api','import')) — whitelist known sources
--
-- Rollback SQL:
--   DROP INDEX IF EXISTS idx_orders_auto_synced_at;
--   DROP INDEX IF EXISTS idx_orders_sync_source;
--   ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_sync_source_check;
--   ALTER TABLE orders DROP COLUMN IF EXISTS oms_order_ref;
--   ALTER TABLE orders DROP COLUMN IF EXISTS auto_synced_at;
--   ALTER TABLE orders DROP COLUMN IF EXISTS sync_source;
--
-- Risks:
--   Low. Columns are additive and nullable (except sync_source which has a default).
--   The CHECK constraint will fail INSERTs with unknown sync_source values — code paths
--   in orderIngest.js and orderMutations.js use only the whitelisted values.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS sync_source    TEXT        NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS auto_synced_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS oms_order_ref  TEXT        NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'orders' AND constraint_name = 'orders_sync_source_check'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_sync_source_check
      CHECK (sync_source IN ('manual','oms','api','import'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_sync_source    ON orders (sync_source);
CREATE INDEX IF NOT EXISTS idx_orders_auto_synced_at ON orders (auto_synced_at DESC);

COMMENT ON COLUMN orders.sync_source IS
  'Where the order originated: manual (UI entry), oms (OMS→middleware→TMS auto), api (third-party push), import (bulk file).';
COMMENT ON COLUMN orders.auto_synced_at IS
  'Timestamp when the order was auto-ingested from OMS via middleware. NULL for manual orders.';
COMMENT ON COLUMN orders.oms_order_ref IS
  'Original OMS order identifier. Preserved for traceability across OMS↔TMS.';
