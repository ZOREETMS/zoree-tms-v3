-- =============================================================================
-- Migration: 20260407_dock_door_standalone_index
-- Purpose:   Add standalone index on dock_door for queries that filter by door
--            without a pickup_date predicate (e.g. dock utilization reports).
-- =============================================================================
--
-- Schema Changes: None (index only)
--
-- Index Changes:
--   - idx_shipments_dock_door on (dock_door) WHERE dock_door IS NOT NULL
--
-- Existing Related Index:
--   - idx_shipments_pickup_dock on (pickup_date, dock_door) — from 20260406
--     Covers date+door combos but not door-only lookups.
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_shipments_dock_door;
--
-- Affected APIs/Services/UI:
--   - UI: DockSchedulingPage (filters by door)
--   - Future: Dock utilization reports, door-level analytics
--
-- Risks/Assumptions:
--   - Partial index (WHERE NOT NULL) keeps index small since most legacy rows are NULL
-- =============================================================================

create index if not exists idx_shipments_dock_door
  on public.shipments (dock_door)
  where dock_door is not null;
