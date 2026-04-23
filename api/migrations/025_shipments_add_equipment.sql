-- Migration: 025_shipments_add_equipment
-- Date:      2026-04-22
-- Author:    Claude (AI-assisted)
-- Feature:   Carry the rate's equipment onto the shipment row
--
-- Purpose
-- ───────
-- Migration 024 added `rates.equipment` (the trailer the rate was
-- negotiated against). When the planner picks a rate to build a
-- shipment, the chosen equipment must travel with it so:
--   • the shipment detail UI can display "Equipment: Dry Van 53ft"
--     alongside Carrier / Mode;
--   • dispatch and audit views can answer "what trailer was this
--     load planned for?" without re-deriving it from the rate row;
--   • re-quoting / re-planning can re-use the same equipment as a
--     starting point.
--
-- ───────────────────────────────────────────────────────────────
-- 1. SCHEMA CHANGES
-- ───────────────────────────────────────────────────────────────
--   shipments.equipment   TEXT  (nullable; soft reference to
--                                equipment_types.name — same
--                                contract as rates.equipment)
--
-- ───────────────────────────────────────────────────────────────
-- 2. BACKFILL
-- ───────────────────────────────────────────────────────────────
--   None on insert. Existing shipment rows pre-date the rate's
--   equipment column, so backfilling them would invent data. New
--   shipments created via /api/bulk-plan/execute will carry the
--   rate's equipment going forward.
--
--   A best-effort one-shot backfill can be run by joining shipments
--   to rates on rate_id — left as a separate operational task
--   because rate_id on legacy shipments is sparse.
--
-- ───────────────────────────────────────────────────────────────
-- 3. INDEX CHANGES
-- ───────────────────────────────────────────────────────────────
--   None. Equipment is for display and audit, not a primary filter.
--   Revisit if the shipments list grows an "Equipment" filter facet.
--
-- ───────────────────────────────────────────────────────────────
-- 4. CONSTRAINT CHANGES
-- ───────────────────────────────────────────────────────────────
--   None. Soft reference (TEXT, no FK) — same rationale as
--   rates.equipment in migration 024: the master's primary key is
--   `id`, and pinning by name avoids breakage on master rename.
--
-- ───────────────────────────────────────────────────────────────
-- 5. AFFECTED APIs / SERVICES / UI
-- ───────────────────────────────────────────────────────────────
--   API:
--     • /api/bulk-plan/rate      — TL/LTL quote payload now carries
--                                   `equipment` from the matched rate.
--     • /api/bulk-plan/execute   — persists plan.equipment onto the
--                                   new shipment row (api/services/
--                                   bulkPlanExecution.js).
--     • /api/ltl/quote           — same: each LTL quote includes
--                                   the rate's equipment.
--   Frontend:
--     • frontend/src/services/ordersService.js (bulkPlanOrders)
--                                — threads bestQuote.equipment into
--                                   the plan payload sent to execute.
--     • frontend/src/pages/ShipmentsPage.jsx
--                                — Equipment shown next to Mode in
--                                   the shipment detail panel.
--
-- ───────────────────────────────────────────────────────────────
-- 6. ROLLBACK (break-glass only — migrations are forward-only)
-- ───────────────────────────────────────────────────────────────
--   ALTER TABLE shipments DROP COLUMN IF EXISTS equipment;
--
-- ───────────────────────────────────────────────────────────────
-- 7. RISKS & ASSUMPTIONS
-- ───────────────────────────────────────────────────────────────
--   • Existing shipment rows stay NULL — UI must render "—" (or
--     similar empty state) when equipment is absent.
--   • Rates without `equipment` set (e.g. legacy modes other than
--     LTL/TL that weren't backfilled by migration 024) will yield
--     shipments with NULL equipment until a planner sets the rate's
--     equipment via the Edit Rate modal.

BEGIN;

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS equipment TEXT;

COMMENT ON COLUMN shipments.equipment IS
  'Soft reference to equipment_types.name. Snapshot of the rate''s '
  'equipment at planning time so the shipment can display the trailer '
  'it was planned against without re-joining to rates. NULL on legacy '
  'rows that pre-date migration 025.';

COMMIT;

-- Verification (run separately):
--   SELECT COUNT(*) FILTER (WHERE equipment IS NULL) AS legacy_null,
--          COUNT(*) FILTER (WHERE equipment IS NOT NULL) AS with_equipment
--     FROM shipments;
