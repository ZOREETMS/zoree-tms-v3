-- ════════════════════════════════════════════════════════════════════
-- Migration: rates — clear stale czarlite flags on non-LTL rows
-- Date:      2026-05-05
-- Bug:       #100 follow-up (Rate Mgmt list view shows "—" while edit
--            modal shows the actual rate).
--
-- Background
--   The CzarLite tariff applies to LTL freight only. The canonical rule
--   lives in frontend/src/services/rateService.js → isCzarLiteApplicable
--   ("isLtlMode(rate.mode) && (rate.czarlite OR carrier.czarlite_enabled)").
--   At least 2 rows in `rates` carry czarlite=true with mode='TL' — almost
--   certainly the residue of a previous (now-removed) data load that
--   defaulted czarlite=true regardless of mode. There is also a prior
--   migration `fix_tl_rates_clear_czarlite_weight_breaks_20260422` that
--   cleared related weight-break columns; this one closes the loop on
--   the boolean + class.
--
--   The Bug #100 code fix (RateManagementPage.formatRate now uses
--   isCzarLiteApplicable) made the list view ignore the stale flag. This
--   migration is defense-in-depth: align the DB with the rule so every
--   other consumer of `rates.czarlite` (badge column, edit modal,
--   filters, the rate matcher) sees a consistent value.
--
-- Forward-only: there is no down migration. Re-flagging a non-LTL row
-- as CzarLite would re-introduce the original bug. Any future mode-
-- migration must keep this invariant.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- Clear the stale CzarLite metadata on rows where the mode disqualifies
-- them. `rate` (the negotiated $/mile or flat) is preserved — only the
-- CzarLite-specific fields are reset. Matches the canonical rule:
-- CzarLite applies only when mode is LTL.
UPDATE public.rates
   SET czarlite        = false,
       czarlite_class  = NULL,
       czarlite_tariff = NULL
 WHERE czarlite = true
   AND lower(coalesce(mode, '')) <> 'ltl';

COMMIT;

-- Post-migration verification (run manually if needed):
--   SELECT mode, COUNT(*)
--     FROM public.rates
--    WHERE czarlite = true
--    GROUP BY mode;
--   -- Expect only 'LTL' (or its case variants) in the result.
