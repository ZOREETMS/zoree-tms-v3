-- Migration: 023_req24_oms_push_tracking_columns
-- Date: 2026-04-21
-- Author: Claude (AI-assisted)
-- Target DB: Single Supabase project that hosts BOTH oms_orders and orders
--            (ljbeihotrmyqthxptcgp). Run in the Supabase SQL Editor.
--            (Corrects the mistargeted header in 010_oms_add_tms_push_tracking.sql,
--            which wrongly said "OMS Supabase project (NOT the TMS DB)" even
--            though migration 011 and the runtime code in api/services/omsSync.js
--            assume both tables share one project. 010 was therefore never logged
--            or applied. This migration supersedes it forward-only — 010 is
--            preserved on disk for history per "never drop files" rule.)
--
-- Description:
--   REQ-24 — mirror the TMS tender-accept onto every linked oms_orders row
--   inline (no middleware round-trip). api/services/omsSync.js already writes
--   `tms_ship_status_pushed_at` when the sync runs, but that column does not
--   exist on oms_orders in production, so the UPDATE throws. The error is
--   swallowed per-order at omsSync.js:86-89 and the order lands in the
--   `skipped` bucket with an opaque reason — the TMS UI still toasts "sent
--   to OMS" but no oms_orders row was actually updated.
--
--   This migration adds the three push-tracking timestamp columns so the
--   auto-sync UPDATE succeeds, and mirrors the index / backfill strategy
--   from the (never-applied) 010 file.
--
-- Schema changes:
--   ALTER TABLE oms_orders
--     + tms_order_pushed_at       TIMESTAMPTZ NULL
--     + tms_ship_status_pushed_at TIMESTAMPTZ NULL
--     + tms_pod_pushed_at         TIMESTAMPTZ NULL
--
-- Backfill:
--   Rows already past each stage are assumed to have been pushed historically
--   (otherwise the sync would replay them on every middleware cycle). Stamp
--   them with NOW() so the next cycle does not re-emit:
--     - tms_order_pushed_at       for stage >= 4
--     - tms_ship_status_pushed_at for stage >= 10 AND tms_shipment_id IS NOT NULL
--     - tms_pod_pushed_at         for stage >= 11 AND tms_shipment_id IS NOT NULL
--
-- Index changes:
--   Partial indexes on `stage`, scoped to "still to push" rows only. Keeps
--   the index small and matches the exact middleware queries that filter
--   on `.is('<col>','null')`:
--     + idx_oms_orders_order_push_pending  (stage) WHERE tms_order_pushed_at       IS NULL
--     + idx_oms_orders_ship_push_pending   (stage) WHERE tms_ship_status_pushed_at IS NULL
--     + idx_oms_orders_pod_push_pending    (stage) WHERE tms_pod_pushed_at         IS NULL
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
--   api/services/omsSync.js
--     - syncTenderAcceptToOms stamps tms_ship_status_pushed_at = NOW() on each
--       oms_orders row it updates (already in code — unblocked by this migration).
--   api/server.js
--     - POST /api/oms/push returns { syncResult: { updated, skipped } } so the
--       UI can distinguish "sent to OMS" from "skipped — no OMS row / column
--       missing / other error".
--   frontend/src/pages/ShipmentsPage.jsx
--     - confirmAcceptTender toast reflects the real skipped count instead of
--       an unconditional success message.
--   frontend/zoree-middleware.html
--     - runPushOrderFlow  : filter `.is('tms_order_pushed_at','null')`;       UPDATE on success
--     - runPushShipFlow   : filter `.is('tms_ship_status_pushed_at','null')`; UPDATE on success
--     - runPushPODFlow    : filter `.is('tms_pod_pushed_at','null')`;         UPDATE on success
--     (middleware-side wiring is tracked in 010's original notes; no change
--     in this migration's scope — the forward fix is the column availability.)
--
-- Risks / assumptions:
--   - Assumption: historical stage-10/11 rows with a tms_shipment_id have
--     already been pushed to TMS. Backfill stamps them NOW(). If a row was
--     genuinely never pushed, a one-time manual NULL of the column re-enables
--     the push on the next auto-sync cycle.
--   - Low risk: all additions are nullable, no existing queries reference
--     these columns, no constraints added, indexes are partial and small.
--   - Safe to re-run: every statement uses IF NOT EXISTS and idempotent UPDATEs.

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
  'Timestamp of the last successful order-header push to TMS (runPushOrderFlow). NULL = not yet pushed; auto-sync will pick it up. Added by migration 023.';
COMMENT ON COLUMN oms_orders.tms_ship_status_pushed_at IS
  'Timestamp of the last successful shipment-status push to TMS (runPushShipFlow) OR of the inline tender-accept auto-sync (api/services/omsSync.js). NULL = not yet pushed. Added by migration 023.';
COMMENT ON COLUMN oms_orders.tms_pod_pushed_at IS
  'Timestamp of the last successful POD / "Delivered" push to TMS (runPushPODFlow). NULL = not yet pushed; auto-sync will pick it up. Added by migration 023.';
