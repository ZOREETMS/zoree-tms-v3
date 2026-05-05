-- Migration: 035_backfill_shipment_cost_breakdown
-- Date:      2026-05-04
-- Author:    Claude (AI-assisted)
-- Feature:   Backfill rate / fuel_surcharge from rates.fsc on shipment
--            rows the bulk planner saved with a zero-only breakdown.
--
-- Purpose
-- ───────
-- A regression in `frontend/src/services/ordersService.js#bulkPlanOrders`
-- (the "Schedule" / "Plan All" path) constructed plan bodies inline at
-- four call sites and omitted `rate`, `fuelSurcharge`, and
-- `accessorials`. The API's bulk-plan executor defaults each to 0, so
-- shipments produced by Schedule landed with `total_cost` correct but
-- `rate = fuel_surcharge = accessorials = 0`. The Shipment Details modal
-- then derived base = total − fuel − accessorials = total, rendering
-- "Fuel Surcharge (10.0%) $0" against rates that actually carry a
-- non-zero FSC.
--
-- The code regression was fixed in the same change set that introduces
-- this migration — every plan-body builder in `bulkPlanOrders` now
-- mirrors the `confirmPlan` / `buildPlan` mapping
-- (`czarBaseGross → rate`, `fscCharge → fuelSurcharge`,
-- `accessorialCharge → accessorials`). This migration repairs the rows
-- already written before the fix.
--
-- ───────────────────────────────────────────────────────────────
-- 1. SCHEMA CHANGES
-- ───────────────────────────────────────────────────────────────
--   None. Pure data backfill against existing
--   shipments.{rate, fuel_surcharge} numeric columns.
--
-- ───────────────────────────────────────────────────────────────
-- 2. BACKFILL
-- ───────────────────────────────────────────────────────────────
--   Target rows:
--     • shipments.rate_id resolves to a rate with a non-empty fsc
--       string (e.g. '10.0%', '22%').
--     • total_cost > 0
--     • rate = 0 (or NULL) AND fuel_surcharge = 0 (or NULL) AND
--       accessorials = 0 (or NULL) — the exact "zero breakdown"
--       signature produced by the regression. Rows where any breakdown
--       column is non-zero are left alone (already correct, or
--       deliberately overridden by Manual Plan).
--
--   Reconstruction (mirrors api/server.js TL/LTL quote math):
--     fsc_pct  = parseFloat(strip non-numeric from rates.fsc)
--     base     = ROUND(total_cost / (1 + fsc_pct/100), 2)
--     fuel     = total_cost - base
--   Accessorials stays 0 — none of the affected shipments had any.
--
--   Idempotent: the WHERE predicate excludes rows that already carry a
--   breakdown, so re-running this script is a no-op.
--
--   Rows NOT touched (intentional):
--     • rate_id NULL — no rate to read fsc from (manual plans, legacy).
--     • rates.fsc NULL or empty — rate row exists but FSC was blank;
--       reconstructing as base=total, fuel=0 doesn't add information,
--       so the row stays $0/$0 rather than gain a misleading "real"
--       split. The modal already derives base=total in this case.
--     • rate_id points to a rate row that has since been deleted /
--       renamed (ON DELETE was never enforced). LEFT JOIN keeps these
--       rows visible, but the WHERE clause drops them when fsc IS NULL.
--
-- ───────────────────────────────────────────────────────────────
-- 3. INDEX CHANGES
-- ───────────────────────────────────────────────────────────────
--   None.
--
-- ───────────────────────────────────────────────────────────────
-- 4. CONSTRAINT CHANGES
-- ───────────────────────────────────────────────────────────────
--   None.
--
-- ───────────────────────────────────────────────────────────────
-- 5. AFFECTED APIs / SERVICES / UI
-- ───────────────────────────────────────────────────────────────
--   • frontend/src/utils/shipmentCost.js#deriveShipmentCostBreakdown
--       Reads shipment.rate and shipment.fuel_surcharge directly.
--       After this backfill, baseIsDerived flips false on repaired
--       rows, so the modal stops rendering the "(derived)" label and
--       the Fuel Surcharge tile shows the real dollar amount.
--   • frontend/src/pages/ShipmentsPage.jsx (Shipment Details modal)
--       No change required. The "Fuel Surcharge (X.X%)" label is read
--       from rates.fsc and was always correct; only the dollar value
--       was wrong because it came from the (zero) shipment column.
--   • frontend/src/components/documents/InvoiceDocument.jsx and the
--     freight-audit comparator both consume the breakdown columns.
--     Audits run against the repaired rows will now compare apples to
--     apples instead of "audited base = $X" vs "shipment base = $0".
--
-- ───────────────────────────────────────────────────────────────
-- 6. ROLLBACK (break-glass only — migrations are forward-only)
-- ───────────────────────────────────────────────────────────────
--   No automated rollback. The pre-backfill state was rate = 0 and
--   fuel_surcharge = 0 on every affected row; if a rollback is ever
--   needed, restore from a point-in-time backup taken before this
--   migration runs (cheaper than re-deriving the original zero state,
--   which had no extra information to preserve).
--
-- ───────────────────────────────────────────────────────────────
-- 7. RISKS & ASSUMPTIONS
-- ───────────────────────────────────────────────────────────────
--   • Reconstructed split assumes the shipment was rated under the
--     SAME fsc the rate carries today. If a rate's fsc was edited
--     between plan-time and migration-time, the repair will reflect
--     today's fsc, not the original. This matches what the modal
--     already shows in its "Fuel Surcharge (X.X%)" label (also read
--     live from rates.fsc), so the row stays internally consistent.
--   • ROUND-half-even at 2 decimals. base + fuel = total_cost exactly
--     because fuel is computed as total - base after the round, not
--     independently. Deterministic, idempotent.
--   • No accessorials reconstruction. None of the affected rows had
--     any (verified pre-migration); reconstructing accessorials from
--     a rate row would also be wrong because accessorials are
--     per-shipment, not per-rate. Rows with accessorials > 0 are
--     excluded by the WHERE predicate.
--   • LEFT JOIN by `rates.lane = shipments.rate_id`. The historical
--     rate_id format is the rate's `lane` column verbatim
--     (e.g. JBHT-COL-SJC-TL-STD-20261231), so this is the natural
--     join key. A small number of legacy shipments may carry
--     rate_id = rates.id::text instead — those are caught by the
--     OR branch, with DISTINCT ON to guard against multi-match.

BEGIN;

WITH affected AS (
  SELECT
    s.id                                                            AS shipment_id,
    s.total_cost                                                    AS total_cost,
    -- regexp_replace strips '%' (and any stray non-numeric/non-dot
    -- characters) so '22%', '22.5%', and '10.0%' all parse the same.
    NULLIF(regexp_replace(coalesce(r.fsc, ''), '[^0-9.]', '', 'g'), '')::numeric
                                                                    AS fsc_pct
  FROM shipments s
  LEFT JOIN LATERAL (
    SELECT fsc
    FROM rates
    WHERE lane = s.rate_id OR id::text = s.rate_id
    ORDER BY (lane = s.rate_id) DESC
    LIMIT 1
  ) r ON TRUE
  WHERE s.rate_id IS NOT NULL
    AND s.total_cost > 0
    AND COALESCE(s.rate, 0)           = 0
    AND COALESCE(s.fuel_surcharge, 0) = 0
    AND COALESCE(s.accessorials, 0)   = 0
    AND r.fsc IS NOT NULL
    AND btrim(r.fsc) <> ''
)
UPDATE shipments s
SET
  rate           = ROUND(a.total_cost / (1 + a.fsc_pct / 100), 2),
  fuel_surcharge = a.total_cost - ROUND(a.total_cost / (1 + a.fsc_pct / 100), 2)
FROM affected a
WHERE s.id = a.shipment_id
  AND a.fsc_pct IS NOT NULL
  AND a.fsc_pct > 0;

COMMIT;

-- Verification (run separately):
--   -- Should return 0 rows after the migration runs cleanly.
--   SELECT s.id, s.rate_id, s.total_cost, s.rate, s.fuel_surcharge, r.fsc
--   FROM shipments s
--   LEFT JOIN rates r ON r.lane = s.rate_id
--   WHERE s.rate_id IS NOT NULL
--     AND s.total_cost > 0
--     AND COALESCE(s.rate, 0)           = 0
--     AND COALESCE(s.fuel_surcharge, 0) = 0
--     AND COALESCE(s.accessorials, 0)   = 0
--     AND r.fsc IS NOT NULL
--     AND btrim(r.fsc) <> '';
--
--   -- Spot-check that base + fuel = total_cost for repaired rows.
--   SELECT id, total_cost, rate, fuel_surcharge,
--          (rate + fuel_surcharge) AS reconstructed_total,
--          total_cost - (rate + fuel_surcharge) AS drift
--   FROM shipments
--   WHERE id IN ('SHP-2026-9818','SHP-2026-2295','SHP-2026-2286',
--                'SHP-2026-2164','SHP-2026-2272','SHP-2026-3829');
