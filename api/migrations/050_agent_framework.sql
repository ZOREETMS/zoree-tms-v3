-- ═══════════════════════════════════════════════════════════════════
-- 050_agent_framework.sql — AI agent runs + proposed actions
-- ─────────────────────────────────────────────────────────────────────
-- Why: five back-office agents (quote, carrier sourcing, track & trace,
-- freight audit, document/POD) propose actions that a human approves
-- before anything changes in the TMS. Each run and each proposed action
-- needs one durable row so that (a) the approval inbox survives a
-- restart, (b) a retried run can never execute the same action twice,
-- and (c) every TMS change an agent caused traces back to the run, the
-- evidence it used and the person who approved it.
-- Implements P0.3 of docs/agentic-architecture-plan.md.
--
-- 1. Schema changes (DDL)
--    + table public.agent_runs     (one row per agent execution)
--    + table public.agent_actions  (one row per proposed action, FK → agent_runs)
--
-- 2. Migration files: this file only. Apply in Supabase SQL Editor
--    (or the Management API, as for 024/025/032-034).
--
-- 3. Backfill: none. Both tables start empty.
--
-- 4. Indexes (from the query patterns in services/agents/agentRunStore.js)
--    + idx_agent_runs_agent_started   (tenant_id, agent, started_at DESC)  — console run list per agent
--    + idx_agent_actions_run          (run_id)                             — actions for one run
--    + idx_agent_actions_inbox        (tenant_id, status, created_at DESC) — approval inbox
--    + uq_agent_actions_idem          (tenant_id, idempotency_key) UNIQUE  — no double execution
--
-- 5. Constraints
--    + agent / trigger / status CHECKs (controlled values, per DB rules)
--    + agent_actions.action_type CHECK (closed list; a new action type
--      needs a migration, the same as a new status)
--    + agent_actions.run_id FK ON DELETE CASCADE
--
--    Denormalization note: agent_runs.input, agent_actions.payload and
--    agent_actions.result are JSONB. They are immutable snapshots — what
--    the agent was given, what it proposed (with its evidence), and what
--    the executing service returned. They are never joined or filtered
--    on; the relational effect of an approved action is written to the
--    normal shipments / invoices / message_log tables by the existing
--    single-writer services. Keeping them as documents is what makes
--    "what did the AI see vs. what did a human approve" auditable.
--
-- 6. Rollback
--    DROP TABLE IF EXISTS public.agent_actions;
--    DROP TABLE IF EXISTS public.agent_runs;
--    (Safe at any time: no other table references these.)
--
-- 7. Affected APIs / services / UI
--    NEW  api/services/agents/** (runner, policies, store, executors, 5 agents)
--    NEW  api/services/rating/tlQuoteService.js (TL pricing shared with /api/bulk-plan/rate)
--    NEW  api/routes/agents.js → /api/agents/*
--    NEW  frontend/src/pages/AgentConsolePage.jsx + components/agents/*
--    No change to existing tables or reads.
--
-- 8. Risks / assumptions
--    - Approved actions execute through existing services
--      (shipmentEvents.applyShipmentEvent, shipmentMutations.changeShipmentCarrier,
--      invoiceAudit.manualDecide, invoiceFromShipment, messagingHub writer),
--      so REQ-02 change_history and patch guards apply unchanged.
--    - change_history rows written on approval carry the approver as the
--      user and metadata.agent_run_id / agent_action_id for traceability.
--    - RLS is enabled with no anon policy: only the service-role API reads
--      or writes. The OMS/middleware HTML apps never touch these tables.
--    - Assumes public.set_updated_at() exists (migration 20260516170000).
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.agent_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      text        NOT NULL DEFAULT 'zoree-default',
  agent          text        NOT NULL,
  trigger        text        NOT NULL DEFAULT 'manual',
  status         text        NOT NULL DEFAULT 'running',
  entity_type    text,
  entity_id      text,
  input          jsonb,
  summary        text,
  model          text,
  input_tokens   integer,
  output_tokens  integer,
  error          text,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_runs_agent_check
    CHECK (agent IN ('quote','carrier_sourcing','track_trace','freight_audit','document_pod')),
  CONSTRAINT agent_runs_trigger_check
    CHECK (trigger IN ('manual','event','schedule','email')),
  CONSTRAINT agent_runs_status_check
    CHECK (status IN ('running','awaiting_approval','completed','failed'))
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_started
  ON public.agent_runs (tenant_id, agent, started_at DESC);

CREATE TABLE IF NOT EXISTS public.agent_actions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id             uuid        NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  tenant_id          text        NOT NULL DEFAULT 'zoree-default',
  action_type        text        NOT NULL,
  entity_type        text,
  entity_id          text,
  title              text        NOT NULL,
  payload            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status             text        NOT NULL DEFAULT 'proposed',
  requires_approval  boolean     NOT NULL DEFAULT true,
  idempotency_key    text        NOT NULL,
  decided_by         text,
  decided_at         timestamptz,
  executed_at        timestamptz,
  result             jsonb,
  error              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_actions_status_check
    CHECK (status IN ('proposed','executing','executed','rejected','failed')),
  CONSTRAINT agent_actions_type_check
    CHECK (action_type IN (
      'SEND_QUOTE',
      'SEND_LOAD_OFFER','ASSIGN_CARRIER',
      'SEND_CHECK_CALL','APPLY_SHIPMENT_EVENT','NOTIFY_CUSTOMER',
      'DISPUTE_INVOICE','APPROVE_INVOICE',
      'MARK_DELIVERED','CREATE_INVOICE','FLAG_OSD'
    ))
);

CREATE INDEX IF NOT EXISTS idx_agent_actions_run   ON public.agent_actions (run_id);
CREATE INDEX IF NOT EXISTS idx_agent_actions_inbox ON public.agent_actions (tenant_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_actions_idem ON public.agent_actions (tenant_id, idempotency_key);

DROP TRIGGER IF EXISTS trg_agent_runs_updated_at ON public.agent_runs;
CREATE TRIGGER trg_agent_runs_updated_at
  BEFORE UPDATE ON public.agent_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_agent_actions_updated_at ON public.agent_actions;
CREATE TRIGGER trg_agent_actions_updated_at
  BEFORE UPDATE ON public.agent_actions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_actions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.agent_runs IS
  'One row per AI agent execution (quote, carrier_sourcing, track_trace, freight_audit, document_pod).';
COMMENT ON TABLE public.agent_actions IS
  'Actions an agent proposed. Approval-tier actions wait in proposed until a user approves (executes via the owning service) or rejects.';

COMMIT;

NOTIFY pgrst, 'reload schema';
