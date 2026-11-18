-- ═══════════════════════════════════════════════════════════════════
-- 058_invoice_revisions.sql
-- ─────────────────────────────────────────────────────────────────────
-- Why: a carrier often re-sends a disputed or held invoice under the SAME
-- invoice number with corrected charges. That must become a linked
-- revision (re-audited on its own), not a duplicate. The original is kept
-- with its audit history but can never be paid. Approved for 2026-11-17.
--
-- 1. Schema changes (DDL)
--    ~ invoices.status CHECK: + 'Superseded' (original replaced by a revision)
--    + column invoices.supersedes_invoice_id → invoices(id), nullable
--      (set on the revision; points at the original it replaces)
--
-- 2. Migration file: this file. Forward-only.
--
-- 3. Backfill: none. Existing rows keep their status; the new column is NULL.
--    Pre-check before the unique index: no domain + carrier + normalized
--    invoice number already has two Approved/Paid rows (verified: 0 rows).
--
-- 4. Indexes
--    + idx_invoices_supersedes (supersedes_invoice_id) WHERE NOT NULL
--    + uq_invoices_one_payable — see 5
--
-- 5. Constraints
--    ~ invoices_status_check — controlled values incl. 'Superseded'
--    + FK supersedes_invoice_id → invoices(id) ON DELETE SET NULL
--    + uq_invoices_one_payable: UNIQUE (domain_code, upper(trim(carrier)),
--      normalized invoice_number) WHERE status IN ('Approved','Paid').
--      The database itself refuses a second payable invoice for the same
--      carrier + invoice number ("BW-5521" = "bw 5521").
--
-- 6. Rollback
--    UPDATE public.invoices SET status = 'Cancelled' WHERE status = 'Superseded';
--    DROP INDEX IF EXISTS public.uq_invoices_one_payable;
--    DROP INDEX IF EXISTS public.idx_invoices_supersedes;
--    ALTER TABLE public.invoices DROP COLUMN IF EXISTS supersedes_invoice_id;
--    ALTER TABLE public.invoices DROP CONSTRAINT invoices_status_check;
--    ALTER TABLE public.invoices ADD CONSTRAINT invoices_status_check CHECK
--      (status IN ('Pending','Approved','Rejected','Disputed','On Hold','Cancelled','Paid'));
--
-- 7. Affected services/UI
--    services/invoiceIntake/intakeService.js  — revision vs duplicate vs adjustment
--    services/invoiceAudit.js                 — manual approve of a revision
--    services/agents/freightAudit/index.js    — duplicate check ignores Superseded
--    services/apRelease/index.js              — only 'Approved' is releasable (unchanged)
--    frontend invoice list / drawer           — Superseded badge + revision link
--
-- 8. Risks / assumptions
--    - carrier compared by name (carrier_id is not always set)
--    - 'posted' = Approved or Paid; corrections to those go to a person
--    - code paths that set Approved must handle a unique violation (23505)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_status_check CHECK
  (status IN ('Pending','Approved','Rejected','Disputed','On Hold','Cancelled','Paid','Superseded'));

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS supersedes_invoice_id text
  REFERENCES public.invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_supersedes
  ON public.invoices (supersedes_invoice_id)
  WHERE supersedes_invoice_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_one_payable
  ON public.invoices (
    coalesce(domain_code, ''),
    upper(btrim(carrier)),
    regexp_replace(upper(invoice_number), '[^A-Z0-9]', '', 'g')
  )
  WHERE status IN ('Approved','Paid');

COMMIT;
