-- Migration: 042_invoice_cost_lines_and_bol
-- Date: 2026-05-09
-- Author: Claude (AI-assisted)
-- Description: REQ-184/185/186/187 — invoicing cost-line breakdown, BOL
--              references on invoices, and an "On Hold" default for the
--              new "auto-create invoice from shipment" path.
--
--              Two changes in one migration:
--              (a) Add `invoices.bol_ids TEXT[]` so every invoice carries
--                  the BOL identifier(s) it covers (REQ-187). For carrier-
--                  submitted invoices this is what the carrier sends; for
--                  TMS-initiated (direct-from-shipment) invoices it is
--                  populated from the linked shipment(s)' `bol_number`.
--              (b) Create `invoice_cost_lines` so each cost component
--                  (base, fuel surcharge, accessorial, discount, other)
--                  carries BOTH an `invoice_cost` (what the carrier sent)
--                  AND an `approved_cost` (what finance approves). The
--                  `approved_cost` defaults to `invoice_cost` (REQ-186).
--
-- Affected APIs/UI:
--   api/services/invoiceAudit.js          — submitInvoice now accepts and
--                                            persists bol_ids; rejects
--                                            BOL/shipment mismatches.
--   api/services/invoiceFromShipment.js  (NEW) — creates an invoice from
--                                            a shipment in a single
--                                            transaction, status='On Hold'.
--   api/services/invoiceCostLines.js     (NEW) — CRUD for cost lines,
--                                            wires changeHistory diffs.
--   api/routes/invoices.js                — adds GET/PATCH cost-lines.
--   api/routes/shipments.js               — POST /:id/invoice for the
--                                            "Invoice" button on shipments.
--   frontend/src/components/invoices/InvoiceModal.jsx
--   frontend/src/components/invoices/InvoiceCostLines.jsx (NEW)
--   frontend/src/pages/FreightInvoicesPage.jsx
--   frontend/src/pages/ShipmentsPage.jsx
--
-- Backfill:
--   - `invoices.bol_ids` left NULL on existing rows. Legacy invoices keep
--     working; the audit only enforces BOL match when `bolId` is supplied.
--   - No cost-line backfill. Legacy invoices keep using the existing
--     `agreed_cost` / `invoiced_amount` scalars; the new modal renders
--     the scalars when `invoice_cost_lines` is empty for an invoice.
--
-- Index changes:
--   + idx_invoice_cost_lines_invoice_id — FK lookup (the dominant query).
--
-- Constraint changes:
--   + cost_type CHECK in ('base','fuel_surcharge','accessorial','discount','other')
--   + invoice_cost  CHECK >= 0
--   + approved_cost CHECK >= 0
--   + FK invoice_id → invoices(id) ON DELETE CASCADE
--
-- Rollback SQL:
--   DROP INDEX IF EXISTS idx_invoice_cost_lines_invoice_id;
--   DROP TABLE IF EXISTS invoice_cost_lines;
--   ALTER TABLE invoices DROP COLUMN IF EXISTS bol_ids;
--
-- Risks / assumptions:
--   - Additive table + nullable column. No enum changes on `invoices.status`
--     because 'On Hold' is already in the existing CHECK list (mig 008).
--   - `invoice_cost_lines.invoice_cost` is mutable so a corrected carrier
--     resubmit can be reflected in place. Edits go through the service
--     layer and are recorded via `recordFieldDiffs` (REQ-02).
--   - Cost lines are not unique by (invoice_id, cost_type) — accessorials
--     can repeat (e.g. detention + lumper). `line_order` keeps display
--     order stable.

-- ── (a) BOL ids on invoices ──────────────────────────────────────
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS bol_ids TEXT[] NULL;

COMMENT ON COLUMN invoices.bol_ids IS
  'REQ-187: BOL identifiers this invoice covers. Populated from shipment(s).bol_number for direct-create invoices, or supplied by the carrier on a submitted invoice. Validated against the linked shipment(s) before the cost decision runs.';

-- ── (b) invoice_cost_lines table ─────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_cost_lines (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      TEXT         NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  cost_type       TEXT         NOT NULL,
  description     TEXT         NULL,
  invoice_cost    NUMERIC(12,2) NOT NULL DEFAULT 0,
  approved_cost   NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_order      INT          NOT NULL DEFAULT 0,
  tenant_id       TEXT         NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'invoice_cost_lines'
      AND constraint_name = 'invoice_cost_lines_cost_type_check'
  ) THEN
    ALTER TABLE invoice_cost_lines
      ADD CONSTRAINT invoice_cost_lines_cost_type_check
      CHECK (cost_type IN ('base','fuel_surcharge','accessorial','discount','other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'invoice_cost_lines'
      AND constraint_name = 'invoice_cost_lines_invoice_cost_check'
  ) THEN
    ALTER TABLE invoice_cost_lines
      ADD CONSTRAINT invoice_cost_lines_invoice_cost_check
      CHECK (invoice_cost >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'invoice_cost_lines'
      AND constraint_name = 'invoice_cost_lines_approved_cost_check'
  ) THEN
    ALTER TABLE invoice_cost_lines
      ADD CONSTRAINT invoice_cost_lines_approved_cost_check
      CHECK (approved_cost >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoice_cost_lines_invoice_id
  ON invoice_cost_lines (invoice_id);

COMMENT ON TABLE  invoice_cost_lines IS
  'REQ-186: per-cost-line breakdown of an invoice. Each row carries the carrier-billed amount (invoice_cost) and the finance-approved amount (approved_cost). approved_cost defaults to invoice_cost. cascade-deletes with the parent invoice.';
COMMENT ON COLUMN invoice_cost_lines.cost_type      IS 'base | fuel_surcharge | accessorial | discount | other';
COMMENT ON COLUMN invoice_cost_lines.description    IS 'Free-text label for accessorials and "other" lines (e.g. "Detention 2 hrs", "Lumper").';
COMMENT ON COLUMN invoice_cost_lines.invoice_cost   IS 'Amount billed by the carrier (or copied from shipment.* on direct-from-shipment create).';
COMMENT ON COLUMN invoice_cost_lines.approved_cost  IS 'Amount finance has approved. Defaults to invoice_cost; editable until the invoice is sent to AP.';
COMMENT ON COLUMN invoice_cost_lines.line_order     IS 'Stable display order. Lower numbers render first.';
