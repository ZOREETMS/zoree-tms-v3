-- Migration: 045_eia_fuel_surcharge
-- Date: 2026-07-12
-- Author: Claude (AI-assisted)
-- Description: EIA-indexed fuel surcharge (FSC) support.
--              1) carriers.eia_fsc_enabled — per-carrier opt-in checkbox.
--                 When TRUE the rating engine overrides the static
--                 rates.fsc percentage with a percentage looked up from
--                 the carrier's uploaded FSC schedule using the current
--                 EIA U.S. National Average On-Highway Diesel price.
--              2) carrier_fsc_schedules — bracket table uploaded from an
--                 xlsx like "CHR_Fuel_Surcharge_Lookup.xlsx": each row is
--                 (min_price $/gal → fsc_pct %). Lookup rule: the row with
--                 the LARGEST min_price <= current diesel price wins.
--              3) eia_fuel_prices — weekly cache of the EIA diesel index
--                 (fetched from the EIA public RSS feed or API, or entered
--                 manually) so rating never blocks on an external call.
--
-- Affected APIs/UI:
--   api/services/eiaFuelService.js         — reads/writes eia_fuel_prices
--   api/services/fscSchedule.js            — reads carrier_fsc_schedules
--   api/routes/fsc.js                      — /api/fsc/* CRUD + EIA refresh
--   api/server.js                          — /api/ltl/quote + /api/bulk-plan/rate
--                                            FSC override when eia_fsc_enabled
--   frontend/src/pages/CarriersPage.jsx    — new EIA FSC checkbox
--   frontend/src/services/carriersService.js — persists eia_fsc_enabled
--   frontend/src/pages/FuelSurchargePage.jsx — new page (upload + view)
--
-- Backfill:
--   None. eia_fsc_enabled defaults FALSE (existing behavior unchanged);
--   the two new tables start empty and are populated by upload / fetch.
--
-- Index changes:
--   + idx_carrier_fsc_schedules_carrier (carrier_id) — per-carrier bracket
--     load on every quote for enabled carriers.
--   + UNIQUE (carrier_id, min_price) on carrier_fsc_schedules — one bracket
--     per price point per carrier; enables idempotent re-upload.
--   + UNIQUE (price_date) on eia_fuel_prices — one price per EIA week;
--     enables upsert-on-refresh.
--
-- Constraint changes:
--   + carrier_fsc_schedules.min_price  CHECK (min_price >= 0)
--   + carrier_fsc_schedules.fsc_pct    CHECK (fsc_pct >= 0 AND fsc_pct <= 100)
--   + carrier_fsc_schedules.carrier_id FK → carriers(id) ON DELETE CASCADE
--   + eia_fuel_prices.price_usd_per_gallon CHECK (> 0)
--
-- Rollback SQL:
--   DROP TABLE IF EXISTS carrier_fsc_schedules;
--   DROP TABLE IF EXISTS eia_fuel_prices;
--   ALTER TABLE carriers DROP COLUMN IF EXISTS eia_fsc_enabled;
--
-- Risks:
--   Low. Additive only. Rating behavior changes ONLY for carriers whose
--   eia_fsc_enabled is toggled TRUE *and* that have a schedule uploaded
--   *and* a cached EIA price exists — otherwise the engine falls back to
--   the existing static rates.fsc percentage. Multi-tenant note: carriers
--   has no tenant_id today, so the schedule table follows the same
--   single-tenant model (revisit together if carriers gains tenant_id).

-- 1) Carrier opt-in flag
ALTER TABLE carriers
  ADD COLUMN IF NOT EXISTS eia_fsc_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN carriers.eia_fsc_enabled IS
  'When TRUE, rating overrides the static rates.fsc % with a lookup from carrier_fsc_schedules keyed on the current EIA diesel price (eia_fuel_prices).';

-- 2) Per-carrier FSC bracket schedule (uploaded from xlsx)
CREATE TABLE IF NOT EXISTS carrier_fsc_schedules (
  id          BIGSERIAL     PRIMARY KEY,
  carrier_id  TEXT          NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  min_price   NUMERIC(6,3)  NOT NULL CHECK (min_price >= 0),
  fsc_pct     NUMERIC(7,4)  NOT NULL CHECK (fsc_pct >= 0 AND fsc_pct <= 100),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (carrier_id, min_price)
);

CREATE INDEX IF NOT EXISTS idx_carrier_fsc_schedules_carrier
  ON carrier_fsc_schedules (carrier_id);

COMMENT ON TABLE carrier_fsc_schedules IS
  'FSC lookup brackets per carrier: the row with the largest min_price <= current EIA diesel $/gal supplies fsc_pct (percent applied to linehaul). Uploaded via the Fuel Surcharge page.';
COMMENT ON COLUMN carrier_fsc_schedules.min_price IS 'Bracket floor, USD per gallon (e.g. 1.51).';
COMMENT ON COLUMN carrier_fsc_schedules.fsc_pct   IS 'Fuel surcharge percent applied to linehaul (e.g. 17.4 = 17.4%).';

-- 3) Cached EIA diesel index (weekly)
CREATE TABLE IF NOT EXISTS eia_fuel_prices (
  id                    BIGSERIAL     PRIMARY KEY,
  price_date            DATE          NOT NULL UNIQUE,
  price_usd_per_gallon  NUMERIC(6,3)  NOT NULL CHECK (price_usd_per_gallon > 0),
  source                TEXT          NOT NULL DEFAULT 'eia_rss',
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

COMMENT ON TABLE eia_fuel_prices IS
  'Weekly EIA U.S. National Average On-Highway Diesel price cache. source: eia_rss | eia_api | manual. Latest price_date row is the rating input.';
