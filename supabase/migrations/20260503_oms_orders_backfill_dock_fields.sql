-- =============================================================================
-- Migration: 20260503_oms_orders_backfill_dock_fields
-- Purpose:   One-time backfill of oms_orders.dock_door / loading_start /
--            loading_end from the linked shipments row, for rows where
--            the OMS column is empty/NULL but the shipment already
--            carries the value.
--
-- Note: shipments has a `dock_time` text column (the human-readable
-- "06:00–08:00" window) but oms_orders does NOT — the OMS modals derive
-- the window from loading_start / loading_end. So this migration only
-- backfills the three columns that exist on both sides.
-- =============================================================================
--
-- Background:
--   The OMS Load & Ship / Pick / Pack / Stage modals render dock-related
--   fields from oms_orders (frontend/zoree-oms.html → _omsBaseHdr). These
--   columns are normally populated via two paths:
--
--     1. api/services/omsSync.js#syncTenderAcceptToOms — fires on tender
--        accept and mirrors the shipment-side dock onto oms_orders.
--     2. frontend/zoree-middleware.html runPullPlanningFlow — mirrors
--        shipment fields when the OMS order transitions stage 4 → 5.
--
--   Path 2 was reading the wrong column (legacy `dock_assigned` instead
--   of `dock_door` — fixed in this changeset). And path 1 only fires on
--   tender-accept, not on later dock changes (a new helper
--   syncDockToOms now covers post-accept changes for new mutations).
--
--   Neither of those forward-looking fixes touches OMS rows whose dock
--   was already assigned on the shipment side before the fix. This
--   migration backfills those rows in one shot.
--
-- Schema Changes: None (data-only).
--
-- Data Changes:
--   For every oms_orders row where:
--     - tms_shipment_id is set, AND
--     - dock_door is NULL/empty, AND
--     - the linked shipments.dock_door has a value
--   set oms_orders.dock_door to shipments.dock_door.
--   Same independent rule applied per-column to loading_start and
--   loading_end so existing OMS-side values are preserved.
--   updated_at is bumped to the migration time for the rows we touch.
--
-- Index Changes: None.
--   - idx_shipments_dock_door (from 20260407_dock_door_standalone_index)
--     supports the lookup, but this is a one-time bulk update so the join
--     plan will likely seq-scan oms_orders + index-scan shipments by id.
--
-- Constraint Changes: None.
--
-- Rollback:
--   Forward-only — the pre-state (OMS column was NULL, shipment had a
--   value) is not recoverable from the diff alone. Point-in-time database
--   backup is the rollback path. The migration is idempotent: the WHERE
--   clause excludes already-populated rows, so re-running it is a no-op.
--
-- Affected APIs / Services / UI:
--   - frontend/zoree-oms.html: Load & Ship / Pick / Pack / Stage modals
--     start showing the dock door + dock window for backfilled rows.
--   - No API or service contract change.
--
-- Risks / Assumptions:
--   - oms_orders.tms_shipment_id is the canonical FK to shipments.id
--     (verified across api/services/omsSync.js and the middleware).
--   - Per-column null-safety means OMS-side values entered manually
--     (e.g. via the OMS Stage modal) are never overwritten. Mirrors the
--     setIf() pattern used at runtime in omsSync.js.
--   - If a shipment was re-docked later but the OMS row already has a
--     (possibly stale) value, this migration won't touch it — by design.
--     The OMS edit wins; the next syncDockToOms call will reconcile.
--   - dock_door is the primary visible field; loading_start /
--     loading_end are mirrored independently for parity with what
--     syncTenderAcceptToOms / syncDockToOms write at runtime.
-- =============================================================================

update public.oms_orders o
   set dock_door     = coalesce(nullif(o.dock_door,    ''), s.dock_door),
       loading_start = coalesce(nullif(o.loading_start,''), s.loading_start),
       loading_end   = coalesce(nullif(o.loading_end,  ''), s.loading_end),
       updated_at    = now()
  from public.shipments s
 where o.tms_shipment_id = s.id
   and (
         (coalesce(nullif(o.dock_door,    ''), null) is null
            and coalesce(nullif(s.dock_door,    ''), null) is not null)
      or (coalesce(nullif(o.loading_start,''), null) is null
            and coalesce(nullif(s.loading_start,''), null) is not null)
      or (coalesce(nullif(o.loading_end,  ''), null) is null
            and coalesce(nullif(s.loading_end,  ''), null) is not null)
       );
