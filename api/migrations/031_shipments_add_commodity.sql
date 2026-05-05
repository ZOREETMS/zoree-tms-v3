-- Migration: 031_shipments_add_commodity
-- Date:      2026-05-03
-- Author:    Claude (AI-assisted)
-- Feature:   Snapshot the consolidated commodity onto the shipment row
--
-- Purpose
-- ───────
-- The Shipment Details modal renders Commodity from
--   `commodityFromLinked || ds._commodity || ds.commodity || "—"`
--
-- where `commodityFromLinked` and `_commodity` are derived at runtime
-- from `orders WHERE shipment_id = shipments.id` via
-- `frontend/src/utils/shipmentFromOrders.js#deriveCommodityFromOrders`.
--
-- This works for shipments that have linked orders, but breaks down in
-- two real cases:
--   1. Copy Shipment — the copy flow intentionally does NOT carry
--      `order_ids` (those orders stay attached to the original
--      shipment), so the copy renders Commodity = "—" forever even
--      though the freight characteristics are otherwise identical.
--   2. Standalone shipments created without orders attached at the
--      moment of viewing (orders detached, deleted, or never linked).
--
-- A snapshot column on `shipments` lets the modal fall through to a
-- frozen-at-plan-time value while still preferring the live derivation
-- when linked orders exist (fallback chain stays the same — only the
-- terminal `ds.commodity` now has data behind it).
--
-- ───────────────────────────────────────────────────────────────
-- 1. SCHEMA CHANGES
-- ───────────────────────────────────────────────────────────────
--   shipments.commodity   TEXT  (nullable; comma-separated unique
--                                 commodity values aggregated from the
--                                 orders linked at the time the
--                                 shipment row was inserted)
--
-- ───────────────────────────────────────────────────────────────
-- 2. BACKFILL
-- ───────────────────────────────────────────────────────────────
--   Populate `shipments.commodity` for every existing shipment from
--   its currently-linked orders, mirroring the runtime aggregation in
--   deriveCommodityFromOrders (DISTINCT non-empty commodity values
--   joined with ', ' in alphabetical order).
--
--   Linkage source: `orders.shipment_id = shipments.id` (NOT
--   `shipments.order_ids`, which is denormalized and may lag during
--   replan/unassign flows).
--
--   Idempotent: only writes rows where `shipments.commodity IS NULL`,
--   so re-running this script (or running migration 031 twice) leaves
--   already-snapshotted rows untouched.
--
-- ───────────────────────────────────────────────────────────────
-- 3. INDEX CHANGES
-- ───────────────────────────────────────────────────────────────
--   None. Commodity is for display, not a query predicate. Revisit
--   only if a "filter shipments by commodity" facet is added.
--
-- ───────────────────────────────────────────────────────────────
-- 4. CONSTRAINT CHANGES
-- ───────────────────────────────────────────────────────────────
--   None. Free-text TEXT, optional. Mirrors the `commodity` column
--   on `orders` (also free-text, no enum / lookup).
--
-- ───────────────────────────────────────────────────────────────
-- 5. AFFECTED APIs / SERVICES / UI
-- ───────────────────────────────────────────────────────────────
--   API:
--     • POST /api/bulk-plan/execute (api/services/bulkPlanExecution.js)
--                                — derives commodity from the plan's
--                                   orderIds and writes it onto the
--                                   shipment row at insert time. Single
--                                   extra dbSelect against `orders`,
--                                   batched per plan.
--     • POST /api/shipments      — accepts an explicit `commodity`
--                                   value (no behaviour change required;
--                                   the route does an unfiltered upsert
--                                   so the new column flows through).
--   Frontend:
--     • frontend/src/services/shipmentService.js#copyShipment
--                                — carries `s.commodity` forward onto
--                                   the new shipment row so the
--                                   snapshot survives the copy.
--     • frontend/src/pages/ShipmentsPage.jsx (modal)
--                                — no change required. Existing
--                                   fallback chain (`commodityFromLinked
--                                   || _commodity || ds.commodity`)
--                                   already reads the new column as the
--                                   terminal fallback; this migration
--                                   simply makes that fallback non-empty.
--
-- ───────────────────────────────────────────────────────────────
-- 6. ROLLBACK (break-glass only — migrations are forward-only)
-- ───────────────────────────────────────────────────────────────
--   ALTER TABLE shipments DROP COLUMN IF EXISTS commodity;
--
-- ───────────────────────────────────────────────────────────────
-- 7. RISKS & ASSUMPTIONS
-- ───────────────────────────────────────────────────────────────
--   • The snapshot is point-in-time at shipment creation. If linked
--     orders change commodity post-plan (rare — commodity is set at
--     order entry and not edited downstream), the snapshot drifts
--     from the live derivation. The modal mitigates this by reading
--     the live derivation FIRST (commodityFromLinked) and only
--     falling back to the snapshot when no orders are linked — which
--     is exactly the copy / detached cases this column targets.
--   • Backfill aggregates DISTINCT non-empty commodities. Shipments
--     with all-blank linked-order commodities stay NULL (correct —
--     there is no data to snapshot).
--   • Backfill ORDER BY commodity in the string_agg keeps the snapshot
--     deterministic across re-runs (same input → same output).
--   • `unaccent`, collation: not used. Plain text comparison; matches
--     the runtime Set-dedup in deriveCommodityFromOrders.

BEGIN;

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS commodity TEXT;

COMMENT ON COLUMN shipments.commodity IS
  'Snapshot of the comma-separated unique commodity values from the '
  'orders linked at the time the shipment was inserted. The Shipment '
  'Details modal prefers the live derivation from currently-linked '
  'orders and only falls back to this column when no orders are '
  'linked (e.g. a Copy Shipment that intentionally drops order_ids). '
  'Snapshotted by api/services/bulkPlanExecution.js on bulk plan '
  'and by frontend copyShipment on copy. NULL on legacy rows that '
  'pre-date migration 031 with no linked orders to backfill from.';

-- One-shot backfill: aggregate commodity from currently-linked orders
-- using the same DISTINCT-join-with-comma rule as
-- deriveCommodityFromOrders. Idempotent on `shipments.commodity IS NULL`
-- so re-running is safe.
UPDATE shipments s
SET commodity = sub.commodities
FROM (
  SELECT
    shipment_id,
    string_agg(DISTINCT commodity, ', ' ORDER BY commodity) AS commodities
  FROM orders
  WHERE shipment_id IS NOT NULL
    AND commodity IS NOT NULL
    AND btrim(commodity) <> ''
  GROUP BY shipment_id
) sub
WHERE s.id = sub.shipment_id
  AND s.commodity IS NULL;

COMMIT;

-- Verification (run separately):
--   SELECT
--     COUNT(*) FILTER (WHERE commodity IS NULL)     AS still_null,
--     COUNT(*) FILTER (WHERE commodity IS NOT NULL) AS snapshotted,
--     COUNT(*)                                       AS total
--   FROM shipments;
--
--   -- Spot-check: snapshot vs live derivation for a sample of rows
--   SELECT s.id, s.commodity AS snapshot,
--          (SELECT string_agg(DISTINCT o.commodity, ', ' ORDER BY o.commodity)
--             FROM orders o
--            WHERE o.shipment_id = s.id
--              AND o.commodity IS NOT NULL AND btrim(o.commodity) <> '') AS live
--   FROM shipments s
--   WHERE s.commodity IS NOT NULL
--   LIMIT 20;
