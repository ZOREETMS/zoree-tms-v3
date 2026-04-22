-- Migration: 024_rates_add_equipment
-- Date:      2026-04-22
-- Author:    Claude (AI-assisted)
-- Feature:   Tie each rate record to an equipment type
--
-- Purpose
-- ───────
-- Today the bulk planner caps load weight via hardcoded constants in
-- frontend/src/constants/orders.js (LTL_MAX_WEIGHT=15000,
-- TL_MAX_WEIGHT=44000). Those numbers contradict equipment_types
-- (LTL=20,000 / Dry Van 53ft=45,000) — and they don't let a rate
-- declare the trailer it was negotiated against. Without an explicit
-- per-rate equipment, the planner has no way to read the master's
-- max_weight when binning orders into shipment groups.
--
-- This migration adds an explicit `equipment` column to `rates` and
-- backfills it so the planner (next change) can replace the hardcoded
-- constants with a lookup into equipment_types via this column:
--
--     rates.equipment ─────► equipment_types.name ─────► max_weight
--
-- Soft reference (TEXT, no FK) — consistent with how rates.carrier
-- already references carriers.name. Keeps inserts/updates resilient
-- if the master is reorganised, and matches the loose coupling the
-- planner already uses for carriers.
--
-- ───────────────────────────────────────────────────────────────
-- 1. SCHEMA CHANGES
-- ───────────────────────────────────────────────────────────────
--   rates.equipment   TEXT  (nullable; soft reference to
--                            equipment_types.name)
--
-- ───────────────────────────────────────────────────────────────
-- 2. BACKFILL
-- ───────────────────────────────────────────────────────────────
--   • LTL rates → 'LTL'              (matches equipment_types.name 'LTL')
--   • TL  rates → 'Dry Van 53ft'     (matches equipment_types.name
--                                     'Dry Van 53ft', the default
--                                     dry-van trailer)
--   • Other modes (Intermodal / Flatbed / Reefer / Air Freight / …)
--     left NULL — they will be assigned manually via the Edit Rate
--     modal so we don't presume the wrong default.
--
--   Idempotent: each UPDATE is gated on `equipment IS NULL`, so
--   re-running this migration will not overwrite manually-edited rows.
--
-- ───────────────────────────────────────────────────────────────
-- 3. INDEX CHANGES
-- ───────────────────────────────────────────────────────────────
--   None. The `rates` table is tens-to-hundreds of rows; planner
--   filters already use mode + status + carrier. Adding an index on
--   equipment is speculative — revisit when row count grows or the
--   planner gains an equipment-keyed lookup.
--
-- ───────────────────────────────────────────────────────────────
-- 4. CONSTRAINT CHANGES
-- ───────────────────────────────────────────────────────────────
--   None. We deliberately avoid a FK to equipment_types(name) — the
--   master's primary key is `id`, and pinning rates to a TEXT name
--   would break if the master row is renamed. A future migration
--   may switch to FK on equipment_types(id) once the planner reads
--   that linkage end-to-end.
--
-- ───────────────────────────────────────────────────────────────
-- 5. AFFECTED APIs / SERVICES / UI
-- ───────────────────────────────────────────────────────────────
--   API:
--     • /api/bulk-plan/rate (api/server.js) — widens the PostgREST
--       SELECT to return rates.equipment so the planner can resolve
--       max_weight against equipment_types.
--   UI:
--     • frontend/src/components/EditRateModal.jsx — EQUIPMENT
--       dropdown sourced from equipment_types (Active rows only).
--     • frontend/src/services/rateService.js — equipment column in
--       the CSV import/export template (out of scope here; follow-up).
--
-- ───────────────────────────────────────────────────────────────
-- 6. ROLLBACK (break-glass only — migrations are forward-only)
-- ───────────────────────────────────────────────────────────────
--   ALTER TABLE rates DROP COLUMN IF EXISTS equipment;
--
-- ───────────────────────────────────────────────────────────────
-- 7. RISKS & ASSUMPTIONS
-- ───────────────────────────────────────────────────────────────
--   • Backfill picks 'Dry Van 53ft' for every existing TL rate. If
--     a customer's TL rate was actually negotiated against Reefer or
--     Flatbed, the assignment is wrong and a planner must correct it
--     via the Edit Rate modal. We chose 'Dry Van 53ft' because it is
--     the most common dry-van TL trailer in the equipment master and
--     covers the broadest weight envelope (45,000 lb).
--   • Soft reference: if a planner deletes / renames an equipment
--     row in the master, rates pointing at that name silently lose
--     their max_weight resolution. Until a FK is introduced, the
--     planner code MUST fall back safely (existing constants) when
--     the named master row is missing.
--   • Modes other than LTL/TL stay NULL. The planner must treat NULL
--     equipment as "no master cap known" — fall back to its mode
--     default rather than allowing unbounded weight.

BEGIN;

-- ─── rates: equipment (nullable soft reference to
--     equipment_types.name) ───────────────────────────────────────
ALTER TABLE rates
  ADD COLUMN IF NOT EXISTS equipment TEXT;

-- ─── Backfill: LTL → 'LTL' ────────────────────────────────────
UPDATE rates
   SET equipment = 'LTL'
 WHERE equipment IS NULL
   AND UPPER(COALESCE(mode, '')) = 'LTL';

-- ─── Backfill: TL → 'Dry Van 53ft' ────────────────────────────
UPDATE rates
   SET equipment = 'Dry Van 53ft'
 WHERE equipment IS NULL
   AND UPPER(COALESCE(mode, '')) = 'TL';

-- ─── Column comment (db-rules Operational §2 "document table purpose")
COMMENT ON COLUMN rates.equipment IS
  'Soft reference to equipment_types.name. Identifies the trailer '
  'this rate was negotiated against. Read by the bulk planner to '
  'resolve max_weight from the equipment master when binning orders '
  'into shipment groups. NULL = no master cap declared; planner '
  'must fall back to its mode default.';

COMMIT;

-- Verification (run separately):
--   SELECT mode, equipment, COUNT(*) AS n
--     FROM rates
--    GROUP BY mode, equipment
--    ORDER BY mode, equipment;
