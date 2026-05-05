-- Migration: 032_shipments_add_line_items
-- Date:      2026-05-03
-- Author:    Claude (AI-assisted)
-- Feature:   Snapshot consolidated line items onto the shipment row
--
-- Purpose
-- ───────
-- The Shipment Details modal renders a Line Items table by walking
-- `shipment → linked orders (orders.shipment_id = shipments.id) →
-- order_lines (order_lines.order_id = orders.id)`. This works for
-- shipments that own their orders, but breaks down on Copy Shipment:
-- the copy flow intentionally does NOT duplicate orders, so the new
-- shipment has no linked orders and therefore no line items, even
-- though the freight composition is identical to the source.
--
-- A `line_items` JSONB snapshot column lets the copy carry the source
-- shipment's lines forward without creating shadow ORD- rows the user
-- doesn't want. The modal prefers the live derivation when orders are
-- linked, falling back to the snapshot only when they are not — same
-- pattern as migration 031 (commodity).
--
-- Precedent: `documents.line_items JSONB DEFAULT '[]'::jsonb` already
-- uses this snapshot pattern for BOL document generation
-- (002_create_documents_table.sql).
--
-- ───────────────────────────────────────────────────────────────
-- 1. SCHEMA CHANGES
-- ───────────────────────────────────────────────────────────────
--   shipments.line_items   JSONB   DEFAULT '[]'::jsonb (NOT NULL via
--                                  default; rows store an empty array
--                                  rather than NULL so callers can
--                                  iterate without a null guard).
--
--   Stored shape (per element):
--     {
--       "order_id":     "ORD-024629",     -- source order id
--       "line_num":     1,                -- 1-indexed within order
--       "item_id":      "ITM-1004",       -- soft ref to items.id (text)
--       "description":  "LITHIUM …",      -- free text
--       "qty_ordered":  500,              -- integer
--       "unit_weight":  10,               -- numeric (lbs)
--       "total_weight": 5000              -- numeric (lbs)
--     }
--   Matches what the modal reads at frontend/src/pages/
--   ShipmentsPage.jsx:564-573 (l.order_id, l.item_id, l.description,
--   l.qty_ordered, l.unit_weight, l.total_weight).
--
-- ───────────────────────────────────────────────────────────────
-- 2. BACKFILL
-- ───────────────────────────────────────────────────────────────
--   For every shipment that currently has NULL or empty line_items,
--   aggregate order_lines from currently-linked orders into a JSONB
--   array. Linkage source: `orders.shipment_id = shipments.id` (NOT
--   `shipments.order_ids`, which is a denormalized array that can lag).
--
--   Idempotent: WHERE clause filters out rows that already have a
--   non-empty snapshot, so re-running this script (or running 032
--   twice) leaves already-snapshotted rows untouched.
--
--   Ordering: jsonb_agg ORDER BY (order_id, line_num) keeps the
--   snapshot deterministic across re-runs and matches the modal's
--   visual grouping (lines clustered by order, line_num ascending
--   within each).
--
-- ───────────────────────────────────────────────────────────────
-- 3. INDEX CHANGES
-- ───────────────────────────────────────────────────────────────
--   None. line_items is for display, not a query predicate. Revisit
--   if a "search shipments by item_id" facet is ever added (would
--   want a GIN index on `(line_items)` or a path-specific GIN on
--   `((line_items -> 'item_id'))`).
--
-- ───────────────────────────────────────────────────────────────
-- 4. CONSTRAINT CHANGES
-- ───────────────────────────────────────────────────────────────
--   None enforced at the DB level. JSONB shape is documented above
--   and validated implicitly by the modal's defensive reads
--   (l.item_id || "—", l.qty_ordered || 0, etc.). Same posture as
--   documents.line_items.
--
-- ───────────────────────────────────────────────────────────────
-- 5. AFFECTED APIs / SERVICES / UI
-- ───────────────────────────────────────────────────────────────
--   API:
--     • POST /api/bulk-plan/execute (api/services/bulkPlanExecution.js)
--                                — derives line_items from the plan's
--                                   orderIds (one extra dbSelect on
--                                   order_lines, batched per plan)
--                                   and writes the JSONB array onto
--                                   the shipment row at insert.
--     • POST /api/shipments      — generic upsert; the new column
--                                   flows through unchanged.
--   Frontend:
--     • frontend/src/services/shipmentService.js#copyShipment
--                                — fetches the source's order_lines
--                                   via OrdersApi.lines for each
--                                   linked order, flattens, and
--                                   snapshots onto the new shipment
--                                   row's line_items.
--     • frontend/src/pages/ShipmentsPage.jsx (Line Items useEffect)
--                                — when the shipment has no linked
--                                   orders AND ds.line_items has
--                                   entries, render directly from
--                                   the snapshot instead of fetching
--                                   per-order. Linked-order shipments
--                                   keep the existing live-fetch path
--                                   so post-plan order edits remain
--                                   visible.
--
-- ───────────────────────────────────────────────────────────────
-- 6. ROLLBACK (break-glass only — migrations are forward-only)
-- ───────────────────────────────────────────────────────────────
--   ALTER TABLE shipments DROP COLUMN IF EXISTS line_items;
--
-- ───────────────────────────────────────────────────────────────
-- 7. RISKS & ASSUMPTIONS
-- ───────────────────────────────────────────────────────────────
--   • Snapshot drift: if a planner edits an order's lines AFTER the
--     shipment is planned/copied, the snapshot diverges from the
--     live order_lines. Modal mitigates this by reading live FIRST
--     (when orders are linked) and only falling back to the snapshot
--     when no orders are linked. The drift is therefore invisible
--     to users in the linked-orders case (the dominant case) and
--     only becomes the user-visible source of truth in the
--     no-linked-orders case (Copy Shipment, detached/standalone).
--   • Storage: typical shipment carries 1-10 line items at <1KB each.
--     A 50K-shipment table holds well under 50MB of JSONB. Acceptable.
--   • Backfill aggregates from `orders.shipment_id`, so shipments
--     whose `order_ids` array got out of sync with the actual
--     orders.shipment_id reverse pointer will snapshot the
--     authoritative state (linkage by shipment_id wins).

BEGIN;

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS line_items JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN shipments.line_items IS
  'Snapshot of consolidated order_lines from the orders linked at the '
  'time the shipment was inserted. Element shape: {order_id, line_num, '
  'item_id, description, qty_ordered, unit_weight, total_weight}. The '
  'Shipment Details modal prefers live derivation from currently-linked '
  'orders and falls back to this column only when no orders are linked '
  '(e.g. a Copy Shipment that intentionally drops order_ids). '
  'Snapshotted by api/services/bulkPlanExecution.js on bulk plan and '
  'by frontend copyShipment on copy. Empty array on legacy rows that '
  'pre-date migration 032 with no linked orders to backfill from.';

-- One-shot backfill: aggregate order_lines from currently-linked
-- orders into the JSONB array. Idempotent on empty/NULL line_items so
-- re-running is safe.
UPDATE shipments s
SET line_items = sub.lines
FROM (
  SELECT
    o.shipment_id,
    jsonb_agg(
      jsonb_build_object(
        'order_id',     ol.order_id,
        'line_num',     ol.line_num,
        'item_id',      ol.item_id,
        'description',  ol.description,
        'qty_ordered',  ol.qty_ordered,
        'unit_weight',  ol.unit_weight,
        'total_weight', ol.total_weight
      )
      ORDER BY ol.order_id, ol.line_num
    ) AS lines
  FROM orders o
  JOIN order_lines ol ON ol.order_id = o.id
  WHERE o.shipment_id IS NOT NULL
  GROUP BY o.shipment_id
) sub
WHERE s.id = sub.shipment_id
  AND (s.line_items IS NULL OR s.line_items = '[]'::jsonb);

COMMIT;

-- Verification (run separately):
--   SELECT
--     COUNT(*) FILTER (WHERE jsonb_array_length(line_items) = 0) AS still_empty,
--     COUNT(*) FILTER (WHERE jsonb_array_length(line_items) > 0) AS snapshotted,
--     COUNT(*)                                                    AS total,
--     SUM(jsonb_array_length(line_items))                         AS total_line_items
--   FROM shipments;
--
--   -- Spot-check: snapshot vs live derivation for a sample of rows
--   SELECT s.id,
--          jsonb_array_length(s.line_items) AS snapshot_count,
--          (SELECT COUNT(*)
--             FROM orders o
--             JOIN order_lines ol ON ol.order_id = o.id
--            WHERE o.shipment_id = s.id) AS live_count
--   FROM shipments s
--   WHERE jsonb_array_length(s.line_items) > 0
--   LIMIT 20;
