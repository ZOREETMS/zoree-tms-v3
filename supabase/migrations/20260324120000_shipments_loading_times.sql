-- =============================================================================
-- Migration: 20260324120000_shipments_loading_times
-- Purpose:   Add loading window fields to shipments table so the planned
--            dock loading start/end times are persisted during planning.
-- =============================================================================
--
-- Schema Changes:
--   - loading_start (text, nullable): Loading window start (YYYY-MM-DD HH:mm local)
--   - loading_end   (text, nullable): Loading window end   (YYYY-MM-DD HH:mm local)
--
-- Backfill/Data Migration: None required. Existing shipments will have NULL.
--   New shipments created via /api/bulk-plan/execute and ordersService will
--   populate these fields automatically via dockService.buildDockFields().
--
-- Rollback:
--   ALTER TABLE public.shipments DROP COLUMN IF EXISTS loading_start;
--   ALTER TABLE public.shipments DROP COLUMN IF EXISTS loading_end;
--
-- Affected APIs/Services/UI:
--   - API: POST /api/bulk-plan/execute (writes loading_start, loading_end)
--   - Service: dockService.js — buildDockFields() produces these values
--   - Service: ordersService.js — createShipmentsFromRoute() sets these on MBOL
--   - UI: ShipmentsPage — displays loading_start/end in detail view
--   - UI: DockSchedulingPage — parseLoadingWindow() reads these for grid display
--
-- Risks/Assumptions:
--   - Text type chosen for display parity with dock_time (no timezone conversion)
--   - NULL means no loading window assigned (legacy or dock reservation disabled)
-- =============================================================================

alter table public.shipments
  add column if not exists loading_start text,
  add column if not exists loading_end text;

comment on column public.shipments.loading_start is 'Origin dock loading window start (YYYY-MM-DD HH:mm local)';
comment on column public.shipments.loading_end is 'Origin dock loading window end (YYYY-MM-DD HH:mm local)';
