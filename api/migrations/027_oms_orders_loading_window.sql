-- Migration: 027_oms_orders_loading_window
-- Date:      2026-04-25
-- Author:    Claude (AI-assisted)
-- Purpose:   Mirror the TMS shipment loading window (dock pickup start/end)
--            onto oms_orders so the OMS warehouse modals (Pick / Pack /
--            Stage / Ship) can show the planner-assigned dock time
--            without round-tripping to TMS.
--
-- Schema Changes:
--   - oms_orders.loading_start (text, nullable): Mirrors TMS
--     shipments.loading_start ("YYYY-MM-DD HH:mm local"). Set during
--     tender-accept push by syncTenderAcceptToOms.
--   - oms_orders.loading_end   (text, nullable): Mirrors TMS
--     shipments.loading_end. Same write path.
--
-- Source of truth:
--   TMS shipments.loading_start / loading_end (added in
--   supabase/migrations/20260324120000_shipments_loading_times.sql) are
--   the authoritative values. The OMS columns are a denormalized cache
--   populated by /api/oms/push → syncTenderAcceptToOms — same pattern
--   as carrier, dock_door, bol_number, etc.
--
-- Backfill: None. Existing oms_orders rows keep NULL until their
--   shipment is re-tendered or POST /api/oms/push is replayed. The
--   OMS UI degrades cleanly to "—" when both columns are NULL.
--
-- Affected APIs / Services / UI:
--   - api/services/omsSync.js  (syncTenderAcceptToOms): writes the two
--     new columns from payload.dockLoadStart / payload.dockLoadEnd.
--   - frontend/zoree-oms.html  (dbOrder mapper): reads the new columns
--     into o.loadingStart / o.loadingEnd.
--   - frontend/zoree-oms.html  (openPickModal et al): renders the
--     dock loading window in the warehouse modals.
--
-- Risks / Assumptions:
--   - Strictly additive, nullable text columns → no read/write breakage
--     for clients on the old schema.
--   - Text type chosen for parity with TMS shipments.loading_start
--     (free-form local timestamp string, no timezone conversion).
--
-- Rollback:
--   ALTER TABLE oms_orders DROP COLUMN IF EXISTS loading_start;
--   ALTER TABLE oms_orders DROP COLUMN IF EXISTS loading_end;

ALTER TABLE oms_orders ADD COLUMN IF NOT EXISTS loading_start TEXT;
ALTER TABLE oms_orders ADD COLUMN IF NOT EXISTS loading_end   TEXT;

COMMENT ON COLUMN oms_orders.loading_start IS
  'Origin dock loading window start, mirrored from TMS shipments.loading_start during /api/oms/push.';
COMMENT ON COLUMN oms_orders.loading_end IS
  'Origin dock loading window end, mirrored from TMS shipments.loading_end during /api/oms/push.';
