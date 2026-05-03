-- ─────────────────────────────────────────────────────────────────
-- REQ-31 demo seed: two rates on the same Chicago → Dallas lane
-- ─────────────────────────────────────────────────────────────────
-- Purpose
--   Inserts two example rates so you can exercise the cross-mode
--   rate-shop added in REQ-31:
--
--     (a) AVRT-CHI-DAL-LTL-CZ-STD  — LTL, match_type='city_to_city'
--     (b) JBHT-60601-75201-TL-STD  — TL,  match_type='zip_to_zip'
--
--   Both apply to Chicago → Dallas. When a planner rates an order
--   on this lane, /api/bulk-plan/rate returns one LTL quote (via the
--   city_to_city match) and one TL quote (via the zip_to_zip match),
--   then sorts by totalCharge. Whichever is cheaper wins regardless
--   of mode.
--
-- Prerequisites
--   • Migration 021_rates_add_match_type_and_geo.sql must be applied.
--   • Carriers 'Averitt Express' and 'J.B. Hunt Transport' must exist
--     in the `carriers` table with status='Active'. Adjust the
--     carrier names below if your tenant uses different labels.
--
-- How to run
--   Supabase SQL Editor:        paste + Run
--   psql:                       \i scripts/seed_req31_demo_rates.sql
--   Application migration tool: NOT RECOMMENDED — seeds belong out
--                               of the migration stream (db-rules
--                               §Operational §1).
--
-- Idempotency
--   Uses WHERE NOT EXISTS on the `lane` column so re-running is safe.
--   Delete the rows manually if you want to re-seed with different
--   values.
--
-- Rollback
--   DELETE FROM rates
--     WHERE lane IN ('AVRT-CHI-DAL-LTL-CZ-STD',
--                    'JBHT-60601-75201-TL-STD');
-- ─────────────────────────────────────────────────────────────────

BEGIN;

-- (a) LTL · city_to_city · Averitt Express · Chicago → Dallas
INSERT INTO rates (
  lane, carrier, mode, status, match_type,
  origin, origin_zip, origin_country,
  dest,   dest_zip,   dest_country,
  rate, unit, fsc, discount, discount_flat,
  service_level, transit_days, miles,
  czarlite, czarlite_class,
  eff, exp
)
SELECT
  'AVRT-CHI-DAL-LTL-CZ-STD', 'Averitt Express', 'LTL', 'Active', 'city_to_city',
  'CHICAGO, IL',  NULL, 'USA',
  'DALLAS, TX',   NULL, 'USA',
  '$0.00', 'per cwt', '22.0%', 58, NULL,
  'Standard', 4, 966,
  TRUE, 70,
  '2026-01-01', '2026-12-31'
WHERE NOT EXISTS (
  SELECT 1 FROM rates WHERE lane = 'AVRT-CHI-DAL-LTL-CZ-STD'
);

-- (b) TL · zip_to_zip · J.B. Hunt Transport · 60601 → 75201
INSERT INTO rates (
  lane, carrier, mode, status, match_type,
  origin, origin_zip, origin_country,
  dest,   dest_zip,   dest_country,
  rate, unit, fsc, discount, discount_flat,
  service_level, transit_days, miles,
  czarlite, czarlite_class,
  eff, exp
)
SELECT
  'JBHT-60601-75201-TL-STD', 'J.B. Hunt Transport', 'TL', 'Active', 'zip_to_zip',
  'CHICAGO, IL 60601', '60601', 'USA',
  'DALLAS, TX 75201',  '75201', 'USA',
  '$2.20', 'per mile', '21.0%', NULL, NULL,
  'Standard', 2, 925,
  FALSE, NULL,
  '2026-01-01', '2026-12-31'
WHERE NOT EXISTS (
  SELECT 1 FROM rates WHERE lane = 'JBHT-60601-75201-TL-STD'
);

COMMIT;

-- Verification query — run separately to confirm seed landed:
--   SELECT lane, carrier, mode, match_type, origin_zip, dest_zip
--     FROM rates
--    WHERE lane IN ('AVRT-CHI-DAL-LTL-CZ-STD',
--                   'JBHT-60601-75201-TL-STD');
