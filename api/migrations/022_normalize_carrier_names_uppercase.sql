-- Migration: 022_normalize_carrier_names_uppercase
-- Date:      2026-04-21
-- Author:    Claude (AI-assisted)
-- Feature:   Canonicalize carrier names to UPPERCASE (data + triggers)
--
-- Purpose
-- ───────
-- The LTL quote path and TL rate-shop match a rate row to a carrier
-- row via case-sensitive string compare. Legacy seed data mixed
-- casing ("Averitt Express" in `rates.carrier` vs "AVERITT EXPRESS"
-- in `carriers.name`), so rates silently failed to bind to their
-- carrier and quotes fell back to raw CzarLite base pricing (no
-- discount, no FSC).
--
-- Fix is data-only: canonicalize every carrier-name column to
-- UPPERCASE and install triggers that enforce the invariant on
-- future INSERT/UPDATE. Application code intentionally keeps its
-- case-sensitive compares — the DB is now the source of truth for
-- carrier-name casing.
--
-- ───────────────────────────────────────────────────────────────
-- 1. SCHEMA CHANGES
-- ───────────────────────────────────────────────────────────────
--   None — data-only, plus BEFORE-INSERT/UPDATE triggers on the
--   three tables that store a carrier name.
--
-- ───────────────────────────────────────────────────────────────
-- 2. DATA / INVARIANT CHANGES
-- ───────────────────────────────────────────────────────────────
--   • rates.carrier     → UPPER(rates.carrier)
--   • carriers.name     → UPPER(carriers.name)
--   • shipments.carrier → UPPER(shipments.carrier)
--   Each table gets a BEFORE-INSERT/UPDATE trigger that uppercases
--   the same column automatically. Auto-uppercasing is preferred
--   over a CHECK constraint so forms/imports that accidentally send
--   mixed-case don't get a hard error — they're silently normalized
--   to the canonical form.
--
-- ───────────────────────────────────────────────────────────────
-- 3. AFFECTED APIs / SERVICES / UI
-- ───────────────────────────────────────────────────────────────
--   None directly. /api/ltl/quote and /api/bulk-plan/rate keep
--   their case-sensitive compares — they'll now always see
--   uppercase thanks to the triggers.
--
-- ───────────────────────────────────────────────────────────────
-- 4. ROLLBACK (break-glass only — migrations are forward-only)
-- ───────────────────────────────────────────────────────────────
--   DROP TRIGGER  IF EXISTS rates_carrier_uppercase     ON rates;
--   DROP TRIGGER  IF EXISTS carriers_name_uppercase     ON carriers;
--   DROP TRIGGER  IF EXISTS shipments_carrier_uppercase ON shipments;
--   DROP FUNCTION IF EXISTS fn_rates_carrier_uppercase();
--   DROP FUNCTION IF EXISTS fn_carriers_name_uppercase();
--   DROP FUNCTION IF EXISTS fn_shipments_carrier_uppercase();
--
-- ───────────────────────────────────────────────────────────────
-- 5. RISKS
-- ───────────────────────────────────────────────────────────────
--   • Existing CSV/BOL exports that echoed mixed-case carrier
--     names will now be uppercase. Cosmetic only, matches the
--     carriers-table source of truth.
--   • Triggers run on every write, but these tables are
--     low-traffic (rates: ~hundreds of rows, carriers: ~tens,
--     shipments: write rate bounded by planning throughput). No
--     measurable overhead.

BEGIN;

-- ─── Data backfill: normalize existing rows ─────────────────
UPDATE rates
   SET carrier = UPPER(carrier)
 WHERE carrier IS DISTINCT FROM UPPER(carrier);

UPDATE carriers
   SET name = UPPER(name)
 WHERE name IS DISTINCT FROM UPPER(name);

UPDATE shipments
   SET carrier = UPPER(carrier)
 WHERE carrier IS DISTINCT FROM UPPER(carrier);

-- ─── Triggers: enforce uppercase on future writes ───────────
CREATE OR REPLACE FUNCTION fn_rates_carrier_uppercase()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.carrier IS NOT NULL THEN
    NEW.carrier := UPPER(NEW.carrier);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rates_carrier_uppercase ON rates;
CREATE TRIGGER rates_carrier_uppercase
  BEFORE INSERT OR UPDATE OF carrier ON rates
  FOR EACH ROW EXECUTE FUNCTION fn_rates_carrier_uppercase();

CREATE OR REPLACE FUNCTION fn_carriers_name_uppercase()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.name IS NOT NULL THEN
    NEW.name := UPPER(NEW.name);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS carriers_name_uppercase ON carriers;
CREATE TRIGGER carriers_name_uppercase
  BEFORE INSERT OR UPDATE OF name ON carriers
  FOR EACH ROW EXECUTE FUNCTION fn_carriers_name_uppercase();

CREATE OR REPLACE FUNCTION fn_shipments_carrier_uppercase()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.carrier IS NOT NULL THEN
    NEW.carrier := UPPER(NEW.carrier);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shipments_carrier_uppercase ON shipments;
CREATE TRIGGER shipments_carrier_uppercase
  BEFORE INSERT OR UPDATE OF carrier ON shipments
  FOR EACH ROW EXECUTE FUNCTION fn_shipments_carrier_uppercase();

COMMIT;
