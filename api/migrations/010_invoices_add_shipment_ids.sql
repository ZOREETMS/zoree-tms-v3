-- Migration: 010_invoices_add_shipment_ids
-- Date: 2026-04-17
-- Author: Claude (AI-assisted)
-- Description: REQ-07 consolidated invoice handling.
--              Invoices can now reference multiple shipments. Adds a
--              `shipment_ids TEXT[]` column to the invoices table (the
--              existing `shipment_id` stays for back-compat with
--              single-shipment invoices — it mirrors shipment_ids[0]
--              when an array is provided).
--
-- Affected APIs/UI:
--   api/services/invoiceAudit.js — submitInvoice now accepts
--                                  { shipmentId } OR { shipmentIds: [] };
--                                  resolveShipments() sums agreed_cost
--                                  across all referenced shipments and
--                                  flags missing ones.
--   api/routes/invoices.js       — POST body accepts shipmentIds[].
--   frontend/src/pages/FreightInvoicesPage.jsx — UI accepts multiple
--                                                shipment IDs; table
--                                                shows "N shipments" pill
--                                                when consolidated.
--
-- Backfill:
--   For existing invoices that have a single shipment_id, mirror it into
--   the new shipment_ids array so reports can query uniformly.
--
-- Index changes:
--   + idx_invoices_shipment_ids (GIN) — supports "invoices referencing
--                                       shipment X" queries.
--
-- Constraint changes: none.
--
-- Rollback SQL:
--   DROP INDEX IF EXISTS idx_invoices_shipment_ids;
--   ALTER TABLE invoices DROP COLUMN IF EXISTS shipment_ids;
--
-- Risks:
--   Low. Additive column. The backfill is deterministic (mirror of an
--   existing scalar column) and safe to re-run because the UPDATE is
--   guarded by "WHERE shipment_ids IS NULL".

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS shipment_ids TEXT[] NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_shipment_ids
  ON invoices USING GIN (shipment_ids);

-- Backfill: mirror legacy shipment_id into the new array when the array
-- hasn't been populated yet.
UPDATE invoices
SET shipment_ids = ARRAY[shipment_id]
WHERE shipment_id IS NOT NULL
  AND shipment_ids IS NULL;

COMMENT ON COLUMN invoices.shipment_ids IS
  'REQ-07: array of all shipment ids this (consolidated) invoice covers. The legacy shipment_id column holds the first element for back-compat.';
