-- Migration: 009_add_carriers_cost_per_mile
-- Date: 2026-04-26
-- Author: Claude (AI-assisted)
-- Description: The CarriersPage form has always exposed an "Avg Cost/Mi ($)"
--              input bound to `cost_per_mile`, and the frontend service
--              always emits that key in its insert/update payload. The
--              `carriers` table never had the column, so every "Save Carrier"
--              POST returned a PostgREST "column does not exist" error. The
--              edit path quietly retried via patchWithColumnFallback(); the
--              new-carrier path had no such fallback and failed outright.
--
--              This migration adds the column so the persisted shape lines
--              up with the UI/service contract.
--
-- Affected APIs/UI:
--   frontend/src/pages/CarriersPage.jsx           — already binds to cost_per_mile
--   frontend/src/services/carriersService.js      — already emits cost_per_mile
--   api/server.js (POST/PATCH /api/db/carriers)   — no change; proxies through
--
-- Backfill:
--   None. Default 0 covers existing rows; UI treats 0 / NULL the same way
--   (renders blank in the input).
--
-- Index changes:
--   None. cost_per_mile is not used as a query predicate.
--
-- Constraint changes:
--   + CHECK (cost_per_mile IS NULL OR cost_per_mile >= 0)
--
-- Rollback SQL:
--   ALTER TABLE carriers DROP CONSTRAINT IF EXISTS carriers_cost_per_mile_check;
--   ALTER TABLE carriers DROP COLUMN     IF EXISTS cost_per_mile;
--
-- Risks:
--   Low. Additive, nullable column with a non-negative check. No rate or
--   quote logic currently reads cost_per_mile on the hot path, so an empty
--   value cannot affect rating output.

ALTER TABLE carriers
  ADD COLUMN IF NOT EXISTS cost_per_mile NUMERIC(10,4) NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'carriers' AND constraint_name = 'carriers_cost_per_mile_check'
  ) THEN
    ALTER TABLE carriers
      ADD CONSTRAINT carriers_cost_per_mile_check
      CHECK (cost_per_mile IS NULL OR cost_per_mile >= 0);
  END IF;
END $$;

COMMENT ON COLUMN carriers.cost_per_mile IS 'Average cost per mile (USD/mi) for the carrier. Surfaced in CarriersPage for capacity-planning context. NULL/0 means unset.';
