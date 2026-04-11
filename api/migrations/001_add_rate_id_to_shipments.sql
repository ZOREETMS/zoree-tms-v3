-- Migration: 001_add_rate_id_to_shipments
-- Date: 2026-04-05
-- Author: Claude (AI-assisted)
-- Description: Add rate_id column to shipments table to track which rate record was used for planning.
--
-- Schema Change:
--   Table: shipments
--   Column: rate_id (TEXT, nullable)
--   Purpose: Stores the rate lane ID (e.g. "JBHT-ATL-SJC-TL-STD-20261231") used when planning.
--            Links shipment back to the rate record for audit trail and rate management navigation.
--
-- Affected APIs/Services/UI:
--   - API: POST /api/bulk-plan/execute — now writes rate_id to shipment row
--   - API: POST /api/bulk-plan/rate — TL and LTL quotes now include rateId field
--   - Frontend: ShipmentsPage.jsx — displays rate_id as clickable link to Rate Management
--   - Frontend: ordersService.js — CBOL creation includes rate_id from matched rate
--   - Frontend: bulkPlanService.js — buildPlan includes rateId from bestQuote
--   - Frontend: OrdersPage.jsx — confirmPlan passes rateId in execution plan
--
-- Backfill: No backfill needed. Existing shipments will have rate_id = NULL.
--           New shipments created via Plan Group / Plan Selected will populate rate_id.
--
-- Index: No index needed initially. Add if rate_id filtering becomes a common query pattern.
--
-- Risks:
--   - None. Column is nullable, no constraints. Existing data unaffected.
--   - rate_id is a soft reference (text), not a foreign key — rate records can be deleted
--     without breaking shipments.
--
-- Rollback:
--   ALTER TABLE shipments DROP COLUMN IF EXISTS rate_id;

-- Forward migration
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS rate_id TEXT;

-- Optional: Add comment for documentation
COMMENT ON COLUMN shipments.rate_id IS 'Rate lane ID used for planning (e.g. JBHT-ATL-SJC-TL-STD-20261231). NULL if rate was from CzarLite without a rate table match.';
