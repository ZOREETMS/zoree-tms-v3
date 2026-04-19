-- Migration: 015_shipments_add_seal_number
-- Date: 2026-04-19
-- Author: Claude (AI-assisted)
-- Description: REQ-22 — add a `seal_number` column to shipments so the
--              carrier-supplied trailer seal captured during tender
--              acceptance survives on the shipment row and can be
--              surfaced on the shipment detail UI and in the OMS push
--              payload (REQ-21).
--
-- Affected APIs/UI:
--   frontend/src/pages/ShipmentsPage.jsx            — accept-tender modal
--                                                     input + shipment
--                                                     detail display
--   frontend/src/services/shipmentService.js        — field passthrough
--   api/server.js (POST /api/oms/push)              — seal in push payload
--
-- Backfill:
--   None — column is nullable. Existing rows remain with NULL seal
--   until the next tender acceptance records one.
--
-- Index changes: none.
-- Constraint changes: none — free text.
--
-- Rollback SQL:
--   ALTER TABLE shipments DROP COLUMN IF EXISTS seal_number;
--
-- Risks: low — strictly additive, nullable column.

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS seal_number TEXT;
COMMENT ON COLUMN shipments.seal_number IS
  'REQ-22: carrier-supplied trailer seal number captured during tender acceptance.';
