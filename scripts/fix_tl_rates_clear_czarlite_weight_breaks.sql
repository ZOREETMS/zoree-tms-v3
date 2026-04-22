-- ─────────────────────────────────────────────────────────────────
-- Data fix: clear LTL CzarLite weight breaks from non-LTL rates
-- ─────────────────────────────────────────────────────────────────
-- Date:    2026-04-22
-- Author:  Engineering (planning bug fix)
-- Ticket:  Bulk planning failed for 3 ATLANTA→SAN JOSE orders with
--          NO_CARRIER_QUOTE because the only matching TL rate
--          (JBHT-ATL-SJC-TL-STD-20261231) had czarlite_max_wt=9999.
--
-- Why
--   `czarlite_min_wt` / `czarlite_max_wt` model the weight breaks of
--   an LTL CzarLite tariff. The Edit Rate modal historically defaulted
--   them to 500/9999 for every mode, so several TL rate rows ended up
--   with LTL-volume weight caps. The matcher
--   (api/services/rateMatcher.js → rateAcceptsWeight) treated the
--   constraint as mode-agnostic and skipped the carrier on every TL
--   group whose weight exceeded the cap. Result: bulk planning for
--   any TL > 9,999 lb on those lanes returned NO_CARRIER_QUOTE.
--
--   The matcher was patched in the same change set to ignore these
--   columns for non-LTL modes (defense-in-depth). This script cleans
--   up the existing rows so the data also reflects intent and so
--   anyone reading the rate row no longer sees a misleading cap.
--
-- Impact analysis (per zoree DB rules)
--   • Affected table:    rates
--   • Affected rows:     mode <> 'LTL' AND (czarlite_min_wt IS NOT NULL
--                                           OR czarlite_max_wt IS NOT NULL)
--                        At time of authoring: 3 rows (ids 68, 69, 70).
--   • Schema change:     none. Sets two columns to NULL only.
--   • Reversibility:     fully reversible — original values can be
--                        restored from the backup table created below
--                        (rates_czarlite_wt_backup_20260422).
--   • Downstream effect: TL/Flatbed/Intermodal rates no longer skip a
--                        carrier on weight; LTL rates are untouched.
--   • Planner behaviour: a TL group ≥ TL_MAX (44,000 lb) is split by
--                        the existing bin packer in
--                        frontend/src/services/ordersService.js
--                        before rating, so removing the cap does not
--                        produce illegal over-weight loads.
--
-- Operational rules compliance
--   • Lives under scripts/ (not api/migrations/) per db-rules
--     §Operational §1 — data fixes belong out of the migration stream.
--   • Wrapped in a single transaction.
--   • Idempotent: re-running is a no-op once rows are cleared.
--   • Backup table preserves the prior values.
--
-- How to run
--   Supabase SQL Editor:        paste + Run
--   psql:                       \i scripts/fix_tl_rates_clear_czarlite_weight_breaks.sql
--
-- Rollback
--   BEGIN;
--     UPDATE rates r
--        SET czarlite_min_wt = b.czarlite_min_wt,
--            czarlite_max_wt = b.czarlite_max_wt
--       FROM rates_czarlite_wt_backup_20260422 b
--      WHERE r.id = b.id;
--   COMMIT;
-- ─────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Snapshot current values for the affected rows so the change can
--    be reversed without touching git history or external backups.
CREATE TABLE IF NOT EXISTS rates_czarlite_wt_backup_20260422 (
  id              BIGINT PRIMARY KEY,
  lane            TEXT,
  mode            TEXT,
  czarlite_min_wt INTEGER,
  czarlite_max_wt INTEGER,
  archived_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO rates_czarlite_wt_backup_20260422 (id, lane, mode, czarlite_min_wt, czarlite_max_wt)
SELECT id, lane, mode, czarlite_min_wt, czarlite_max_wt
  FROM rates
 WHERE UPPER(COALESCE(mode, '')) <> 'LTL'
   AND (czarlite_min_wt IS NOT NULL OR czarlite_max_wt IS NOT NULL)
ON CONFLICT (id) DO NOTHING;

-- 2. Clear the LTL-only weight breaks from non-LTL rates.
UPDATE rates
   SET czarlite_min_wt = NULL,
       czarlite_max_wt = NULL
 WHERE UPPER(COALESCE(mode, '')) <> 'LTL'
   AND (czarlite_min_wt IS NOT NULL OR czarlite_max_wt IS NOT NULL);

COMMIT;

-- Verification (run separately):
--   SELECT id, lane, mode, czarlite_min_wt, czarlite_max_wt
--     FROM rates
--    WHERE UPPER(COALESCE(mode, '')) <> 'LTL'
--      AND (czarlite_min_wt IS NOT NULL OR czarlite_max_wt IS NOT NULL);
--   -- expected: 0 rows
--
--   SELECT * FROM rates_czarlite_wt_backup_20260422 ORDER BY id;
--   -- expected: snapshot of the rows that were cleared
