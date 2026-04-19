-- Migration: 011_backfill_sync_source_from_oms
-- Date: 2026-04-18
-- Author: Claude (AI-assisted)
-- Target DB: Single Supabase project that hosts BOTH oms_orders and orders
--            (ljbeihotrmyqthxptcgp). Run in the SQL Editor.
--
-- Description:
--   One-off data correction (NOT a schema change). The middleware's
--   pushOrderService was shipped without stamping TMS provenance columns
--   added back in migration 005 (sync_source / auto_synced_at /
--   oms_order_ref). As a result, historical OMS-origin orders that landed
--   in TMS are still flagged sync_source='manual', so the TMS UI cannot
--   tell them apart from manually-entered orders.
--
--   Forward fix lives in frontend/services/omsSync/pushOrderService.js
--   (mapOmsOrderToTmsRow now sets the three columns). This migration
--   backfills already-pushed rows so the TMS OrdersPage "OMS-synced" badge
--   and any filters on sync_source become correct retroactively.
--
-- Schema changes:
--   None. Data-only migration.
--
-- Migration SQL:
--   Updates orders.{sync_source, auto_synced_at, oms_order_ref} only for
--   rows that (a) have a matching oms_orders row, (b) that oms_orders row
--   has a non-null tms_order_pushed_at (i.e. was actually pushed), and
--   (c) the TMS row is still marked 'manual'. This avoids touching rows
--   that were legitimately manual entries.
--
-- Backfill:
--   This IS the backfill. No further backfill needed.
--
-- Index changes:
--   None. Existing idx_orders_sync_source / idx_orders_auto_synced_at
--   (migration 005) already cover the affected columns.
--
-- Constraint changes:
--   None. 'oms' is already in the orders_sync_source_check whitelist.
--
-- Rollback considerations:
--   Forward-only data correction. A blanket rollback is unsafe because
--   we cannot distinguish rows this migration touched from rows set by
--   the live middleware after deployment. If a rollback is absolutely
--   needed, capture the affected ids via the RETURNING clause below
--   BEFORE running in production:
--
--     WITH affected AS (
--       UPDATE orders o
--          SET sync_source    = 'oms',
--              auto_synced_at = oo.tms_order_pushed_at,
--              oms_order_ref  = oo.id
--         FROM oms_orders oo
--        WHERE o.id = oo.id
--          AND oo.tms_order_pushed_at IS NOT NULL
--          AND o.sync_source = 'manual'
--        RETURNING o.id
--     )
--     SELECT id FROM affected;  -- save this list to revert the specific rows
--
-- Affected APIs/services/UI:
--   frontend/src/pages/OrdersPage.jsx        — OMS-synced badge/filter reads sync_source
--   frontend/src/services/ordersService.js   — subscribeOrderChanges may filter
--   frontend/services/omsSync/pushOrderService.js — forward fix (mapOmsOrderToTmsRow)
--
-- Risks / assumptions:
--   - Assumption: every TMS order whose id matches an oms_orders row with
--     tms_order_pushed_at IS NOT NULL is genuinely OMS-origin. Safe because
--     tms_order_pushed_at is stamped only by the middleware push flow.
--   - We skip rows whose TMS sync_source is already non-'manual' to avoid
--     overwriting 'api' or 'import' markers if any exist.
--   - Low risk: only 3 audit columns change, no status/business fields.

UPDATE orders o
   SET sync_source    = 'oms',
       auto_synced_at = oo.tms_order_pushed_at,
       oms_order_ref  = oo.id
  FROM oms_orders oo
 WHERE o.id = oo.id
   AND oo.tms_order_pushed_at IS NOT NULL
   AND o.sync_source = 'manual';
