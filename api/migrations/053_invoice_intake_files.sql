-- ═══════════════════════════════════════════════════════════════════
-- 053_invoice_intake_files.sql
-- ─────────────────────────────────────────────────────────────────────
-- Why: AP reviews an invoice with the original document next to the
-- fields Zoree AI read from it ("traceable to source"). Until now only
-- the SHA-256 of the PDF was kept, so the original could not be shown.
--
-- 1. Schema changes (DDL)
--    + table public.invoice_intake_files — the original document for one
--      invoice_intakes row (1:1; PK = intake_id).
--      Kept in its own table so intake lists never drag file bytes.
--
-- 2. Migration files: this file only.
--
-- 3. Backfill: none. Documents read before this migration have no file
--    row; the UI says the original was not kept.
--
-- 4. Index changes: none beyond the primary key (every read is by
--    intake_id).
--
-- 5. Constraint changes
--    + FK intake_id → invoice_intakes(id) ON DELETE CASCADE
--    + CHECK size_bytes > 0
--    + RLS enabled, no policies: only the API (service role) reads it.
--
-- 6. Rollback: DROP TABLE public.invoice_intake_files; — nothing else
--    depends on it; intake and audit keep working without it.
--
-- 7. Affected APIs / services / UI
--    - api/services/invoiceIntake/intakeFiles.js   (single writer/reader)
--    - api/services/invoiceIntake/intakeService.js (saves the file with
--      each intake record, best-effort)
--    - GET /api/invoices/intake/:id/file           (finance, same domain)
--    - frontend review drawer shows the document beside the fields
--
-- 8. Risks and assumptions
--    - The file is stored base64 in Postgres, capped by the existing
--      7 MB upload limit. Fine for a pilot; move to object storage at
--      volume. Denormalization: none — one row per document.
--    - Invoice PDFs are customer data. Domain access is enforced through
--      the parent invoice_intakes row (domain_code), so this table needs
--      no domain column of its own.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.invoice_intake_files (
  intake_id      UUID         PRIMARY KEY REFERENCES public.invoice_intakes(id) ON DELETE CASCADE,
  file_name      TEXT         NOT NULL,
  content_type   TEXT         NOT NULL DEFAULT 'application/pdf',
  size_bytes     INTEGER      NOT NULL CHECK (size_bytes > 0),
  content_base64 TEXT         NOT NULL,
  tenant_id      TEXT         NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.invoice_intake_files IS
  'Original document for one invoice_intakes row (base64). Read only through the API; domain is enforced via the parent intake.';

ALTER TABLE public.invoice_intake_files ENABLE ROW LEVEL SECURITY;
