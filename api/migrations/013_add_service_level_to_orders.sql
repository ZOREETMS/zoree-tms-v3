-- Migration: 013_add_service_level_to_orders
-- Date: 2026-04-19
-- Author: Claude (AI-assisted)
-- Description: REQ-10 — add a free-text service_level column to orders so
--              each order can carry a service-level selection that acts
--              as a planning constraint (Standard / Guaranteed / Expedited
--              / White Glove / …). Planner honours it in the same way it
--              already honours ship_mode: rate lookups filter to quotes
--              whose service_level matches, and shipments created from
--              the order inherit the selection.
--
-- Affected APIs/UI:
--   api/services/orderIngest.js                   — OMS → TMS mapper
--                                                   passes service_level
--                                                   through (REQ-11)
--   api/server.js:apiOrderToDbPatch               — accepts serviceLevel
--                                                   on POST/PATCH
--   frontend/src/services/ordersService.js        — fetchCarrierQuotes
--                                                   filters by
--                                                   serviceLevelConstraint
--   frontend/src/pages/OrdersPage.jsx             — new dropdown on the
--                                                   New / Edit Order
--                                                   modals
--
-- Backfill:
--   None — column is nullable. Pre-existing orders remain unconstrained
--   on service level, which is the previous planner behaviour.
--
-- Index changes: none (not a common filter predicate).
-- Constraint changes: none — free text, validated in the UI/API layer.
--
-- Rollback SQL:
--   ALTER TABLE orders DROP COLUMN IF EXISTS service_level;
--
-- Risks: low — additive, nullable column. All existing reads/writes
-- continue working; only code that opts into the new field sees it.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS service_level TEXT;
COMMENT ON COLUMN orders.service_level IS
  'REQ-10: selected service level (Standard, Guaranteed, Expedited, etc.). Acts as a planning constraint — only rates with matching service_level are considered when planning.';
