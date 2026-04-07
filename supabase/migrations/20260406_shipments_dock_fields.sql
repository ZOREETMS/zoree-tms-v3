-- =============================================================================
-- Migration: 20260406_shipments_dock_fields
-- Purpose:   Add dock assignment fields to shipments table so dock door and
--            loading time window are persisted during planning execution.
-- =============================================================================
--
-- Schema Changes:
--   - dock_door (text, nullable): Assigned dock door name (e.g. "Door 1")
--   - dock_time (text, nullable): Human-readable loading window (e.g. "06:00–08:00")
--
-- Existing Columns Used Together:
--   - loading_start (text): Added in 20260324120000_shipments_loading_times
--   - loading_end   (text): Added in 20260324120000_shipments_loading_times
--
-- Backfill/Data Migration: None required. Existing shipments will have NULL
--   dock_door/dock_time. New shipments created via /api/bulk-plan/execute will
--   populate these fields automatically.
--
-- Index Changes: Index on (pickup_date, dock_door) for dock scheduling page
--   which filters shipments by date and groups by door.
--
-- Rollback: Safe to drop columns — no foreign keys or constraints depend on them.
--   ALTER TABLE public.shipments DROP COLUMN IF EXISTS dock_door;
--   ALTER TABLE public.shipments DROP COLUMN IF EXISTS dock_time;
--   DROP INDEX IF EXISTS idx_shipments_pickup_dock;
--
-- Affected APIs/Services/UI:
--   - API: POST /api/bulk-plan/execute (writes dock_door, dock_time, loading_start, loading_end)
--   - API: POST /api/tender/email (reads dock_door, dock_time for tender email)
--   - API: POST /api/oms/push (reads dock fields for OMS integration)
--   - Service: dockService.js (new — assigns dock doors during planning)
--   - UI: PlanConfirmationModal (dock door/time selection)
--   - UI: DockSchedulingPage (reads dock_door from shipments)
--   - UI: ShipmentsPage (displays dock_door, dock_time in detail view)
--
-- Risks/Assumptions:
--   - Assumes dock_door values are free-text; no enum constraint (configurable doors)
--   - NULL dock_door means no dock was assigned (legacy shipments or reservation disabled)
-- =============================================================================

alter table public.shipments
  add column if not exists dock_door text,
  add column if not exists dock_time text;

comment on column public.shipments.dock_door is 'Assigned dock door (e.g. Door 1, Door 2)';
comment on column public.shipments.dock_time is 'Loading time window (e.g. 06:00–08:00)';

-- Index for dock scheduling page: filter by pickup date, group by door
create index if not exists idx_shipments_pickup_dock
  on public.shipments (pickup_date, dock_door)
  where dock_door is not null;
