-- Migration: 010_oms_add_tms_push_tracking
-- Date: 2026-04-18
-- Author: Claude (AI-assisted)
-- Target DB: **OMS Supabase project** (NOT the TMS DB).
--            The other migrations in this folder run against TMS; this one
--            must be run against the OMS Supabase project (SQL Editor) because
--            the `oms_orders` table lives there.
--
-- Description:
--   Fix for auto-sync re-push loop. Today the middleware auto-sync cycle
--   re-queries and re-pushes the same `oms_orders` rows to TMS every tick
--   because the SELECTs have no "already pushed" filter — stage-10/stage-11
--   orders are resubmitted as "In Transit" / "Delivered" on every cycle.
--
--   Adds three nullable timestamp columns so the middleware can skip rows
--   whose current state has already been forwarded to TMS:
--     - tms_order_pushed_at       → set by runPushOrderFlow on successful upsert
--     - tms_ship_status_pushed_at → set by runPushShipFlow on successful status push
--     - tms_pod_pushed_at         → set by runPushPODFlow on successful POD push
--
--   Middleware queries will be changed to include `.is('<col>','null')` so
--   only unsent rows are selected. On successful push, the middleware writes
--   NOW() back to the appropriate column.
--
-- Schema changes:
--   ALTER TABLE oms_orders
--     + tms_order_pushed_at       TIMESTAMPTZ NULL
--     + tms_ship_status_pushed_at TIMESTAMPTZ NULL
--     + tms_pod_pushed_at         TIMESTAMPTZ NULL
--
-- Backfill:
--   Existing rows that are already past each stage are assumed to have been
--   pushed historically (otherwise the log noise this migration fixes would
--   not exist). Stamp them with NOW() so the next cycle does not replay them:
--     - tms_order_pushed_at       backfilled for stage >= 4
--     - tms_ship_status_pushed_at backfilled for stage >= 10 AND tms_shipment_id IS NOT NULL
--     - tms_pod_pushed_at         backfilled for stage >= 11 AND tms_shipment_id IS NOT NULL
--
-- Index changes:
--   Partial indexes targeted at the exact auto-sync queries ("rows still to
--   push"). Keeps the index small — only unsent rows are indexed.
--     + idx_oms_orders_order_push_pending  (stage) WHERE tms_order_pushed_at IS NULL
--     + idx_oms_orders_ship_push_pending   (stage) WHERE tms_ship_status_pushed_at IS NULL
--     + idx_oms_orders_pod_push_pending    (stage) WHERE tms_pod_pushed_at IS NULL
--
-- Constraint changes:
--   None. Columns are additive, nullable, no check constraints.
--
-- Rollback SQL:
--   DROP INDEX IF EXISTS idx_oms_orders_pod_push_pending;
--   DROP INDEX IF EXISTS idx_oms_orders_ship_push_pending;
--   DROP INDEX IF EXISTS idx_oms_orders_order_push_pending;
--   ALTER TABLE oms_orders DROP COLUMN IF EXISTS tms_pod_pushed_at;
--   ALTER TABLE oms_orders DROP COLUMN IF EXISTS tms_ship_status_pushed_at;
--   ALTER TABLE oms_orders DROP COLUMN IF EXISTS tms_order_pushed_at;
--
-- Affected APIs/services/UI:
--   frontend/zoree-middleware.html
--     - runPushOrderFlow  : add  .is('tms_order_pushed_at','null')       filter;
--                           on success UPDATE oms_orders SET tms_order_pushed_at = NOW()
--     - runPushShipFlow   : add  .is('tms_ship_status_pushed_at','null') filter;
--                           on success UPDATE oms_orders SET tms_ship_status_pushed_at = NOW()
--     - runPushPODFlow    : add  .is('tms_pod_pushed_at','null')         filter;
--                           on success UPDATE oms_orders SET tms_pod_pushed_at = NOW()
--   No TMS API / UI changes.
--
-- Risks / assumptions:
--   - Assumption: historical stage-10/11 rows with a tms_shipment_id have
--     already been pushed to TMS. Backfill stamps them NOW(). If a row was
--     genuinely never pushed, a one-time manual NULL of the column re-enables
--     the push on the next cycle.
--   - Low risk: all additions are nullable, no existing queries reference
--     these columns, no constraints added.
--   - If a TMS user manually reverts a status, OMS will not re-push unless
--     the corresponding timestamp column is nulled. Out of scope for this fix.

ALTER TABLE oms_orders
  ADD COLUMN IF NOT EXISTS tms_order_pushed_at       TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS tms_ship_status_pushed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS tms_pod_pushed_at         TIMESTAMPTZ NULL;

-- Backfill: rows already past each stage are assumed pushed.
UPDATE oms_orders
   SET tms_order_pushed_at = NOW()
 WHERE tms_order_pushed_at IS NULL
   AND stage >= 4;

UPDATE oms_orders
   SET tms_ship_status_pushed_at = NOW()
 WHERE tms_ship_status_pushed_at IS NULL
   AND stage >= 10
   AND tms_shipment_id IS NOT NULL;

UPDATE oms_orders
   SET tms_pod_pushed_at = NOW()
 WHERE tms_pod_pushed_at IS NULL
   AND stage >= 11
   AND tms_shipment_id IS NOT NULL;

-- Partial indexes for the "still to push" queries.
CREATE INDEX IF NOT EXISTS idx_oms_orders_order_push_pending
  ON oms_orders (stage)
  WHERE tms_order_pushed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_oms_orders_ship_push_pending
  ON oms_orders (stage)
  WHERE tms_ship_status_pushed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_oms_orders_pod_push_pending
  ON oms_orders (stage)
  WHERE tms_pod_pushed_at IS NULL;

COMMENT ON COLUMN oms_orders.tms_order_pushed_at IS
  'Timestamp of the last successful order-header push to TMS (runPushOrderFlow). NULL = not yet pushed; auto-sync will pick it up.';
COMMENT ON COLUMN oms_orders.tms_ship_status_pushed_at IS
  'Timestamp of the last successful "In Transit" status push to TMS (runPushShipFlow). NULL = not yet pushed; auto-sync will pick it up.';
COMMENT ON COLUMN oms_orders.tms_pod_pushed_at IS
  'Timestamp of the last successful POD / "Delivered" push to TMS (runPushPODFlow). NULL = not yet pushed; auto-sync will pick it up.';
