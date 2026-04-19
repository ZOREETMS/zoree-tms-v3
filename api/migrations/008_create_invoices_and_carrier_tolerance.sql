-- Migration: 008_create_invoices_and_carrier_tolerance
-- Date: 2026-04-17
-- Author: Claude (AI-assisted)
-- Description: REQ-06 carrier invoice approval with tolerance.
--              Introduces a freight `invoices` table for the full
--              lifecycle (Pending → Approved+SentToAP | Rejected) and
--              adds two tolerance columns to `carriers` so the
--              auto-decision logic can vary by carrier.
--
-- Affected APIs/UI:
--   api/services/invoiceAudit.js (NEW)        — tolerance + decision logic
--   api/routes/invoices.js (NEW)               — POST/PATCH/GET /api/invoices
--   api/server.js                              — mounts the router; adds 'invoices' to ALLOWED
--   frontend/src/pages/FreightInvoicesPage.jsx — submit via new endpoint,
--                                                shows variance + decision
--   frontend/src/pages/CarriersPage.jsx        — edits tolerance per carrier
--
-- Backfill:
--   None. New table starts empty; existing hard-coded UI seed data stays
--   as a frontend fallback until the first real invoice is submitted.
--
-- Index changes:
--   + idx_invoices_status      — supports the "pending queue" view
--   + idx_invoices_shipment_id — supports "invoices for this shipment"
--   + idx_invoices_carrier     — supports carrier-level AP reports
--   + idx_invoices_received_at — supports date-range queries
--
-- Constraint changes:
--   + CHECK status IN (...)                    — lifecycle whitelist
--   + CHECK invoiced_amount >= 0
--   + CHECK (tolerance_pct IS NULL OR tolerance_pct BETWEEN 0 AND 100)  — sanity
--
-- Rollback SQL:
--   DROP INDEX IF EXISTS idx_invoices_received_at;
--   DROP INDEX IF EXISTS idx_invoices_carrier;
--   DROP INDEX IF EXISTS idx_invoices_shipment_id;
--   DROP INDEX IF EXISTS idx_invoices_status;
--   DROP TABLE IF EXISTS invoices;
--   ALTER TABLE carriers DROP COLUMN IF EXISTS invoice_tolerance_abs_usd;
--   ALTER TABLE carriers DROP COLUMN IF EXISTS invoice_tolerance_pct;
--
-- Risks:
--   Low. New table, additive columns on carriers. Default tolerance is
--   NULL — the service layer falls back to system defaults (5% + $100)
--   when unset, so existing carriers keep working without configuration.

-- ── Tolerance columns on carriers ────────────────────────────────
ALTER TABLE carriers
  ADD COLUMN IF NOT EXISTS invoice_tolerance_pct     NUMERIC(6,3) NULL,
  ADD COLUMN IF NOT EXISTS invoice_tolerance_abs_usd NUMERIC(10,2) NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'carriers' AND constraint_name = 'carriers_invoice_tolerance_pct_check'
  ) THEN
    ALTER TABLE carriers
      ADD CONSTRAINT carriers_invoice_tolerance_pct_check
      CHECK (invoice_tolerance_pct IS NULL OR (invoice_tolerance_pct >= 0 AND invoice_tolerance_pct <= 100));
  END IF;
END $$;

COMMENT ON COLUMN carriers.invoice_tolerance_pct     IS 'REQ-06: auto-approve if |variance| / agreed_cost × 100 ≤ this %. NULL means fall back to tenant default.';
COMMENT ON COLUMN carriers.invoice_tolerance_abs_usd IS 'REQ-06: auto-approve if |variance| ≤ this $ amount. Applied as an OR with the pct threshold.';

-- ── Invoices table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id               TEXT        PRIMARY KEY,
  invoice_number   TEXT        NOT NULL,
  carrier          TEXT        NULL,
  carrier_id       TEXT        NULL,
  shipment_id      TEXT        NULL,
  invoice_date     DATE        NULL,
  due_date         DATE        NULL,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  agreed_cost      NUMERIC(12,2) NULL,
  invoiced_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  variance         NUMERIC(12,2) NULL,
  variance_pct     NUMERIC(8,3)  NULL,
  tolerance_pct    NUMERIC(6,3)  NULL,
  tolerance_abs_usd NUMERIC(10,2) NULL,
  status           TEXT        NOT NULL DEFAULT 'Pending',
  decision_reason  TEXT        NULL,
  decided_at       TIMESTAMPTZ NULL,
  decided_by       TEXT        NULL,
  sent_to_ap_at    TIMESTAMPTZ NULL,
  sent_to_ap_by    TEXT        NULL,
  payment_terms    TEXT        NOT NULL DEFAULT 'NET30',
  notes            TEXT        NULL,
  metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  tenant_id        TEXT        NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'invoices' AND constraint_name = 'invoices_status_check'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_status_check
      CHECK (status IN ('Pending','Approved','Rejected','Disputed','On Hold','Cancelled','Paid'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'invoices' AND constraint_name = 'invoices_invoiced_amount_check'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_invoiced_amount_check
      CHECK (invoiced_amount >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_status      ON invoices (status);
CREATE INDEX IF NOT EXISTS idx_invoices_shipment_id ON invoices (shipment_id);
CREATE INDEX IF NOT EXISTS idx_invoices_carrier     ON invoices (carrier);
CREATE INDEX IF NOT EXISTS idx_invoices_received_at ON invoices (received_at DESC);

COMMENT ON TABLE  invoices                  IS 'REQ-06: freight invoices with auto-approval against carrier tolerance.';
COMMENT ON COLUMN invoices.status           IS 'Pending | Approved | Rejected | Disputed | On Hold | Cancelled | Paid';
COMMENT ON COLUMN invoices.variance         IS 'invoiced_amount − agreed_cost. Positive = carrier invoiced over, negative = under.';
COMMENT ON COLUMN invoices.tolerance_pct    IS 'Snapshot of the tolerance that was in effect when the decision was made.';
COMMENT ON COLUMN invoices.decision_reason  IS 'Human-readable rationale (e.g. within tolerance, over tolerance, manual override).';
COMMENT ON COLUMN invoices.sent_to_ap_at    IS 'Timestamp when the approved invoice was released to Accounts Payable.';
