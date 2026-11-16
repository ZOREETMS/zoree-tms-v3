-- ═══════════════════════════════════════════════════════════════════
-- 056_invoice_intake_runs.sql
-- ─────────────────────────────────────────────────────────────────────
-- Why: AP needs a log of every time the invoice agent read carrier
-- invoices — on the 5-minute mailbox timer or when someone pressed
-- "Read AP Mailbox" — and which invoices each read produced. Until now a
-- run lived only in server memory (poller.state.lastResult): gone on
-- restart, and nothing tied an invoice_intakes row to the run that read it.
--
-- 1. Schema changes (DDL)
--    + table public.invoice_intake_runs (one row per run, per client domain)
--    + column invoice_intakes.run_id → invoice_intake_runs(id), nullable
--
--    Not reusing agent_runs (migration 050): that table is the decision
--    agents' run + action-approval record (closed agent list, approval
--    statuses, shown in the Agent Console). An intake run has no actions
--    to approve; mixing them would widen 050's CHECKs and its console.
--
-- 2. Migration file: this file. Forward-only.
--
-- 3. Backfill: none. Intakes read before this migration keep run_id NULL
--    and still show in the AP review list (by their source: email/upload).
--
-- 4. Indexes (query patterns in services/invoiceIntake/runRepository.js)
--    + idx_intake_runs_domain_started (domain_code, started_at DESC) — run list
--    + idx_invoice_intakes_run (run_id) WHERE run_id IS NOT NULL      — invoices of a run
--
-- 5. Constraints
--    + trigger IN ('schedule','manual'), channel IN ('ap_mailbox','inbox_folder'),
--      status IN ('running','completed','failed') — controlled values
--    + domain_code FK → domains(code) ON UPDATE CASCADE (same as 052)
--    + invoice_intakes.run_id FK ON DELETE SET NULL (deleting a run never
--      deletes what it read)
--    Counts (ready / held / duplicate …) are NOT stored: they are derived
--    from the linked invoice_intakes + invoices, so they stay right when AP
--    later approves or disputes. Only emails_read is stored — it is a fact
--    about the mailbox at run time that no other table holds.
--
-- 6. Rollback
--    ALTER TABLE public.invoice_intakes DROP COLUMN IF EXISTS run_id;
--    DROP TABLE IF EXISTS public.invoice_intake_runs;
--    (Code treats a missing run as "no run": intake keeps working.)
--
-- 7. Affected APIs / services / UI
--    NEW  services/invoiceIntake/{runContext,runRepository,intakeRuns}.js
--    CHG  emailIntake/poller.js (runs per mailbox read), invoiceIntake/
--         {intakeService,mailboxRun,inboxRun,intakeLog,intakeRepository}.js,
--         domains/domainCodes.js (table is domain-scoped)
--    NEW  GET /api/invoices/intake/runs, GET /api/invoices/intake/runs/:id
--    NEW  Freight Invoices → "Agent runs" tab; AP review shows how each
--         invoice came in (scheduled check / Read AP Mailbox / upload)
--
-- 8. Risks / assumptions
--    - Logging must never block intake: if a run row can't be written the
--      invoice is still read and saved with run_id NULL.
--    - A scheduled check that finds nothing writes no row (a 5-minute timer
--      would otherwise add 288 empty rows a day); its time still shows as
--      "last check" from the server. A pressed button always writes a row.
--    - A run left 'running' by a server crash is shown as interrupted.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.invoice_intake_runs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_code  TEXT        NOT NULL DEFAULT 'ZOREE' REFERENCES public.domains(code) ON UPDATE CASCADE,
  tenant_id    TEXT        NULL,
  trigger      TEXT        NOT NULL,
  channel      TEXT        NOT NULL,
  started_by   TEXT        NOT NULL,
  mailbox      TEXT        NULL,
  status       TEXT        NOT NULL DEFAULT 'running',
  emails_read  INTEGER     NULL,
  error        TEXT        NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invoice_intake_runs_trigger_check CHECK (trigger IN ('schedule','manual')),
  CONSTRAINT invoice_intake_runs_channel_check CHECK (channel IN ('ap_mailbox','inbox_folder')),
  CONSTRAINT invoice_intake_runs_status_check  CHECK (status IN ('running','completed','failed'))
);
CREATE INDEX IF NOT EXISTS idx_intake_runs_domain_started ON public.invoice_intake_runs (domain_code, started_at DESC);

ALTER TABLE public.invoice_intakes
  ADD COLUMN IF NOT EXISTS run_id UUID NULL REFERENCES public.invoice_intake_runs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_intakes_run ON public.invoice_intakes (run_id) WHERE run_id IS NOT NULL;

-- Same as invoice_intakes: RLS on, no anon policy; only the service-role API reads or writes.
ALTER TABLE public.invoice_intake_runs ENABLE ROW LEVEL SECURITY;

COMMIT;

NOTIFY pgrst, 'reload schema';
