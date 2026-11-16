-- ═══════════════════════════════════════════════════════════════════
-- 051_invoice_pdf_intake_and_accessorial_approvals.sql
-- ─────────────────────────────────────────────────────────────────────
-- Why: carrier invoices arrive as PDFs. Claude reads each PDF into an
-- invoice + cost lines, read checks gate what is trusted, and the
-- Freight Audit rules check every extra (liftgate, detention …) against
-- an approval recorded on the shipment — "extras need an approval in the
-- TMS". Today shipments carry one accessorials total, so a $85 liftgate
-- nobody approved passes if the total happens to fit; and an unreadable
-- or duplicate PDF has nowhere to live except the uploader's screen.
--
-- 1. Schema changes (DDL)
--    + table public.shipment_accessorial_approvals
--        one row per approved extra on a shipment: type + either
--        (max_hours × rate_per_hour) or max_amount, who approved, when.
--    + column public.invoice_cost_lines.accessorial_type (nullable)
--        so an accessorial line can be matched to its approval by type.
--    + table public.invoice_intakes
--        one row per PDF received: file hash, read result, confidence,
--        outcome (created / duplicate / needs_manual / failed) and the
--        invoice it produced or duplicated.
--
-- 2. Migration files: this file only. Apply in Supabase SQL Editor
--    (or the Management API, as for 024/025/032-034/050).
--
-- 3. Backfill: none. Existing shipments keep their accessorials total;
--    the audit falls back to that total when a shipment has no approval
--    rows, so nothing already in flight changes behaviour.
--
-- 4. Indexes (from query patterns in the new services)
--    + idx_saa_shipment            (shipment_id)                        — approvals for the shipments on an invoice
--    + idx_invoice_intakes_recent  (tenant_id, created_at DESC)         — intake list on Freight Invoices
--    + idx_invoice_intakes_hash    (tenant_id, file_sha256)             — "this exact PDF was already received"
--
-- 5. Constraints
--    + accessorial_type CHECK — closed list, same on both tables
--      (a new type needs a migration, the same as a new status)
--    + shipment_accessorial_approvals: amount basis must be complete —
--      (max_hours AND rate_per_hour) OR max_amount, all > 0
--    + invoice_intakes.source / status CHECKs (controlled values)
--    + RLS enabled on both new tables, no anon policies (service role only)
--    + FKs: approvals → shipments ON DELETE CASCADE;
--           intakes.invoice_id / duplicate_of_invoice_id → invoices ON DELETE SET NULL
--
--    Denormalization note: invoice_intakes.raw_extraction is JSONB. It is
--    the immutable model output for one PDF — kept so AP can see exactly
--    what the model read versus what was saved. It is never joined or
--    filtered on; the relational result lives in invoices +
--    invoice_cost_lines, written by the existing single-writer services.
--
-- 6. Rollback
--    DROP TABLE IF EXISTS public.invoice_intakes;
--    DROP TABLE IF EXISTS public.shipment_accessorial_approvals;
--    ALTER TABLE public.invoice_cost_lines DROP COLUMN IF EXISTS accessorial_type;
--    (Safe: no other table references these; the audit falls back to
--    shipments.accessorials when no approvals exist.)
--
-- 7. Affected APIs / services / UI
--    NEW  api/services/invoiceIntake/{pdfExtractor,readChecks,intakeRepository,intakeService}.js
--    NEW  api/services/accessorialApprovals.js
--    NEW  POST /api/invoices/intake/pdf, GET /api/invoices/intake
--    NEW  GET/POST/DELETE /api/shipments/:id/accessorial-approvals
--    CHG  api/services/invoiceCostLines.js       (writes accessorial_type)
--    CHG  api/services/invoiceAudit.js           (submitInvoice deferApSend option)
--    CHG  api/services/agents/freightAudit/*     (per-type approval check, passed checks,
--                                                 wrong-base fuel, cancelled, carrier mismatch,
--                                                 duplicate by invoice number)
--    CHG  api/services/emailIntake/{extractor,intakeService}.js + NEW invoiceRouting.js
--         (carrier-invoice emails → PDF intake, sender checked against the carrier's email domain)
--    NEW  frontend invoice PDF upload on Freight Invoices; approved extras on Shipment Details
--
-- 8. Risks / assumptions
--    - shipments.id and invoices.id are TEXT (migrations 008 / base schema).
--    - Per-type approvals only apply to cost lines that carry an
--      accessorial_type (today: PDF intake). Manually keyed invoices keep
--      the aggregate check — no behaviour change for existing flows.
--    - If a shipment has approval rows, an extra with no matching type is
--      flagged even if the old accessorials total would have covered it.
--      That is the intended stricter rule.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.shipment_accessorial_approvals (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id      TEXT          NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  accessorial_type TEXT          NOT NULL,
  max_hours        NUMERIC(6,2)  NULL,
  rate_per_hour    NUMERIC(10,2) NULL,
  max_amount       NUMERIC(12,2) NULL,
  notes            TEXT          NULL,
  approved_by      TEXT          NOT NULL,
  approved_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  tenant_id        TEXT          NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT saa_type_check CHECK (accessorial_type IN
    ('liftgate','detention','lumper','layover','redelivery','inside_delivery','residential','limited_access','other')),
  CONSTRAINT saa_basis_check CHECK (
    (max_hours IS NOT NULL AND rate_per_hour IS NOT NULL AND max_hours > 0 AND rate_per_hour > 0)
    OR (max_amount IS NOT NULL AND max_amount > 0)
  )
);
CREATE INDEX IF NOT EXISTS idx_saa_shipment ON public.shipment_accessorial_approvals (shipment_id);

ALTER TABLE public.invoice_cost_lines ADD COLUMN IF NOT EXISTS accessorial_type TEXT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE table_name = 'invoice_cost_lines' AND constraint_name = 'invoice_cost_lines_accessorial_type_check') THEN
    ALTER TABLE public.invoice_cost_lines ADD CONSTRAINT invoice_cost_lines_accessorial_type_check
      CHECK (accessorial_type IS NULL OR accessorial_type IN
        ('liftgate','detention','lumper','layover','redelivery','inside_delivery','residential','limited_access','other'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.invoice_intakes (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  source                  TEXT          NOT NULL DEFAULT 'pdf_upload',
  file_name               TEXT          NOT NULL,
  file_sha256             TEXT          NOT NULL,
  status                  TEXT          NOT NULL,
  invoice_id              TEXT          NULL REFERENCES public.invoices(id) ON DELETE SET NULL,
  duplicate_of_invoice_id TEXT          NULL REFERENCES public.invoices(id) ON DELETE SET NULL,
  invoice_number          TEXT          NULL,
  carrier                 TEXT          NULL,
  shipment_ref            TEXT          NULL,
  total                   NUMERIC(12,2) NULL,
  read_confidence         NUMERIC(4,3)  NULL,
  model                   TEXT          NULL,
  problems                TEXT[]        NOT NULL DEFAULT '{}',
  read_warnings           TEXT[]        NOT NULL DEFAULT '{}',
  outcome_reason          TEXT          NULL,
  raw_extraction          JSONB         NULL,
  created_by              TEXT          NULL,
  tenant_id               TEXT          NULL,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT invoice_intakes_source_check CHECK (source IN ('pdf_upload','email')),
  CONSTRAINT invoice_intakes_status_check CHECK (status IN ('created','duplicate','needs_manual','failed'))
);
CREATE INDEX IF NOT EXISTS idx_invoice_intakes_recent ON public.invoice_intakes (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_intakes_hash   ON public.invoice_intakes (tenant_id, file_sha256);

-- Match agent_runs / email_order_intake / invoices: RLS on, no anon policies.
-- The Express API uses the service role (bypasses RLS); the anon key used by
-- zoree-oms.html / zoree-middleware.html gets no access to these tables.
ALTER TABLE public.shipment_accessorial_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_intakes ENABLE ROW LEVEL SECURITY;

COMMIT;

NOTIFY pgrst, 'reload schema';
