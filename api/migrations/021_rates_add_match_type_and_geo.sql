-- Migration: 021_rates_add_match_type_and_geo
-- Date:      2026-04-20
-- Author:    Claude (AI-assisted)
-- Feature:   Rate-record match_type + geo columns
--
-- Purpose
-- ───────
-- Today, LTL rate matching at /api/bulk-plan/rate uses a fuzzy
-- `origin.includes(city) && dest.includes(city)` rule on the free-text
-- `rates.origin` / `rates.dest` columns. Two problems with that:
--   1. City name substrings can spuriously match ("Springfield" inside
--      "Springfield Gardens").
--   2. There is no way to say "this rate is a ZIP-to-ZIP contract" or
--      "this rate is a country-to-country fallback". Planners need
--      explicit control.
--
-- This migration adds an explicit `match_type` column to the `rates`
-- table and the structured geo columns needed to honor each mode:
--
--     city_to_city        → match on origin/dest CITY names
--     zip_to_zip          → match on origin/dest ZIP codes
--     country_to_country  → match on origin/dest COUNTRY codes only
--
-- The LTL rate matcher (api/services/ltlRateMatcher.js) reads
-- match_type and strictly skips any rate whose structured fields
-- don't match the shipment's corresponding structured fields.
--
-- ───────────────────────────────────────────────────────────────
-- 1. SCHEMA CHANGES
-- ───────────────────────────────────────────────────────────────
--   rates.match_type       TEXT NOT NULL DEFAULT 'city_to_city'
--                          CHECK IN ('city_to_city','zip_to_zip',
--                                    'country_to_country')
--   rates.origin_zip       TEXT  (promoted out of free-text origin)
--   rates.dest_zip         TEXT  (promoted out of free-text dest)
--   rates.origin_country   TEXT DEFAULT 'USA'
--   rates.dest_country     TEXT DEFAULT 'USA'
--   shipments.origin_country TEXT DEFAULT 'USA'
--   shipments.dest_country   TEXT DEFAULT 'USA'
--
-- ───────────────────────────────────────────────────────────────
-- 2. BACKFILL
-- ───────────────────────────────────────────────────────────────
--   • match_type + countries: handled by the NOT NULL DEFAULT on
--     ADD COLUMN — every existing row gets 'city_to_city' / 'USA'
--     without an explicit UPDATE.
--   • origin_zip / dest_zip: one-time regex extraction from the
--     existing free-text origin/dest columns. Only runs where the
--     new column is NULL, so it's idempotent. Rows without a 5-digit
--     ZIP in the free text stay NULL — correct for city_to_city
--     rates.
--
-- ───────────────────────────────────────────────────────────────
-- 3. INDEX CHANGES
-- ───────────────────────────────────────────────────────────────
--   None. The `rates` table is tens-to-hundreds of rows. Current
--   lookups already filter by mode + status + carrier. Adding
--   indexes on match_type / zip / country is speculative and would
--   violate perf-rules §2 "avoid over-indexing". Revisit if the
--   matcher shows up in slow logs or the row count exceeds ~10k.
--
-- ───────────────────────────────────────────────────────────────
-- 4. CONSTRAINT CHANGES
-- ───────────────────────────────────────────────────────────────
--   One new CHECK constraint — `rates_match_type_check` — enforcing
--   the enum-like allowed values. No FK to a countries table: with
--   only 'USA' in active use, a lookup table is over-engineered.
--
-- ───────────────────────────────────────────────────────────────
-- 5. AFFECTED APIs / SERVICES / UI
-- ───────────────────────────────────────────────────────────────
--   API:
--     • /api/bulk-plan/rate (LTL handler in api/server.js) — widens
--       the PostgREST SELECT list to include the new columns and
--       delegates matching to ltlRateMatcher.
--     • api/services/ltlRateMatcher.js (NEW) — pure matcher.
--     • api/services/bulkPlanExecution.js — persists
--       origin_country / dest_country on the new shipment row.
--   UI:
--     • frontend/src/components/EditRateModal.jsx — MATCH TYPE
--       dropdown, country inputs, ZIP promoted to dedicated payload
--       fields (origin_zip / dest_zip).
--     • frontend/src/pages/RateManagementPage.jsx — Match Type
--       column on the rate list.
--     • frontend/src/services/rateService.js — MATCH_TYPE_OPTIONS
--       + helpers (single source of truth for the enum).
--
-- ───────────────────────────────────────────────────────────────
-- 6. ROLLBACK (break-glass only — migrations are forward-only)
-- ───────────────────────────────────────────────────────────────
--   ALTER TABLE rates     DROP CONSTRAINT IF EXISTS rates_match_type_check;
--   ALTER TABLE rates     DROP COLUMN     IF EXISTS match_type;
--   ALTER TABLE rates     DROP COLUMN     IF EXISTS origin_zip;
--   ALTER TABLE rates     DROP COLUMN     IF EXISTS dest_zip;
--   ALTER TABLE rates     DROP COLUMN     IF EXISTS origin_country;
--   ALTER TABLE rates     DROP COLUMN     IF EXISTS dest_country;
--   ALTER TABLE shipments DROP COLUMN     IF EXISTS origin_country;
--   ALTER TABLE shipments DROP COLUMN     IF EXISTS dest_country;
--
-- ───────────────────────────────────────────────────────────────
-- 7. RISKS & ASSUMPTIONS
-- ───────────────────────────────────────────────────────────────
--   • Behavior shift on the next planning run: strict city-match
--     replaces fuzzy `includes()`. Intended improvement, but run
--     one LTL quote per active tenant as a smoke test before
--     release.
--   • Regex backfill of origin_zip / dest_zip greedily grabs the
--     first 5-digit run in the free-text. If a legacy rate stored
--     something like "Suite 30001, Chicago, IL 60607", the wrong
--     number could land in origin_zip. Mitigation: backfilled zips
--     are NOT READ for existing rows (all default to 'city_to_city'
--     match_type); they're dormant until a user explicitly switches
--     a rate to 'zip_to_zip', at which point they can verify/edit.
--   • `origin_country` / `dest_country` default to 'USA'. If we
--     onboard a non-US tenant, that default is wrong for their
--     pre-existing rows and the per-tenant backfill will need a
--     follow-up migration.
--   • The legacy free-text `rates.origin` / `rates.dest` columns
--     are kept (db-rules §"never drop/rename without safe
--     transition"). Code still reads them for display/CSV export.
--     A future migration can deprecate them once all consumers
--     switch to the structured fields.

BEGIN;

-- ─── rates: match_type (NOT NULL, default 'city_to_city') ─────
ALTER TABLE rates
  ADD COLUMN IF NOT EXISTS match_type TEXT NOT NULL DEFAULT 'city_to_city';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rates_match_type_check'
  ) THEN
    ALTER TABLE rates
      ADD CONSTRAINT rates_match_type_check
      CHECK (match_type IN ('city_to_city', 'zip_to_zip', 'country_to_country'));
  END IF;
END $$;

-- ─── rates: structured geo columns ───────────────────────────
ALTER TABLE rates ADD COLUMN IF NOT EXISTS origin_zip     TEXT;
ALTER TABLE rates ADD COLUMN IF NOT EXISTS dest_zip       TEXT;
ALTER TABLE rates ADD COLUMN IF NOT EXISTS origin_country TEXT DEFAULT 'USA';
ALTER TABLE rates ADD COLUMN IF NOT EXISTS dest_country   TEXT DEFAULT 'USA';

-- ─── shipments: country columns ──────────────────────────────
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS origin_country TEXT DEFAULT 'USA';
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS dest_country   TEXT DEFAULT 'USA';

-- ─── Backfill: extract first 5-digit run from existing origin/dest
--     free-text strings, where origin_zip / dest_zip is still NULL.
UPDATE rates
   SET origin_zip = substring(origin FROM '\d{5}')
 WHERE origin_zip IS NULL
   AND origin ~ '\d{5}';

UPDATE rates
   SET dest_zip = substring(dest FROM '\d{5}')
 WHERE dest_zip IS NULL
   AND dest ~ '\d{5}';

-- ─── Column comments (db-rules Operational §2 "document table purpose")
COMMENT ON COLUMN rates.match_type IS
  'REQ: Controls how the LTL matcher pairs this rate with a shipment. '
  'city_to_city → compare origin/dest city names (case-insensitive exact). '
  'zip_to_zip   → compare origin/dest 5-digit ZIPs. '
  'country_to_country → compare origin/dest country codes only. '
  'See api/services/ltlRateMatcher.js for semantics.';
COMMENT ON COLUMN rates.origin_zip IS
  'Origin 5-digit ZIP. Promoted out of the legacy origin free-text '
  'string so zip_to_zip matching can compare structured values. '
  'Backfilled by migration 021 from origin ~ ''\d{5}''.';
COMMENT ON COLUMN rates.dest_zip IS
  'Destination 5-digit ZIP. See rates.origin_zip.';
COMMENT ON COLUMN rates.origin_country IS
  'Origin country code (ISO-ish, e.g. ''USA'', ''CAN''). '
  'Used by country_to_country match_type. Defaults to ''USA''.';
COMMENT ON COLUMN rates.dest_country IS
  'Destination country code. See rates.origin_country.';
COMMENT ON COLUMN shipments.origin_country IS
  'Origin country of the shipment, mirrored onto the shipment row at '
  'creation time so re-quoting is country-aware. Defaults to ''USA''.';
COMMENT ON COLUMN shipments.dest_country IS
  'Destination country of the shipment. See shipments.origin_country.';

COMMIT;
