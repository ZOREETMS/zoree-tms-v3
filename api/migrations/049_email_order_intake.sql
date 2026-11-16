-- ═══════════════════════════════════════════════════════════════════
-- 049_email_order_intake.sql — Email-to-order intake agent
-- ─────────────────────────────────────────────────────────────────────
-- Why: the email intake agent (api/services/emailIntake/*) reads order
-- requests from a mailbox, has Claude extract the order fields, and
-- holds the result as a draft until a planner approves it. Each email
-- needs one durable row so a message is never processed twice and every
-- order created from an email traces back to the email it came from.
--
-- 1. Schema changes (DDL)
--    + table public.email_order_intake (one row per processed email)
--    + orders.email_intake_id uuid NULL → FK email_order_intake(id)
--    ~ orders_sync_source_check widened: + 'email', + 'fusion'
--      ('fusion' is already written by services/fusionIngest/orders.js
--       but was never added to the whitelist from migration 005.)
--
-- 2. Migration files: this file only. Apply in Supabase SQL Editor.
--
-- 3. Backfill: none. New table starts empty; existing orders keep
--    email_intake_id = NULL. No existing row has sync_source outside
--    ('manual','oms') as of 2026-10-25, so the re-added CHECK validates.
--
-- 4. Indexes
--    + uq_email_order_intake_msg  (tenant_id, mailbox, message_id) UNIQUE
--        dedupe key — the poller's "have I seen this email" check
--    + idx_email_order_intake_queue (tenant_id, status, received_at DESC)
--        the review page lists by status, newest first
--    + idx_orders_email_intake_id (partial, NOT NULL) — order ↔ email lookup
--
-- 5. Constraints
--    + status CHECK (controlled values, per DB rules — no free text)
--    + source CHECK ('imap' = read from mailbox, 'paste' = pasted in UI)
--    + confidence range CHECK 0..1
--    ~ orders_sync_source_check (see 1)
--
--    Denormalization note: `extracted` is JSONB. It is the immutable
--    snapshot of what the model returned (possibly several order drafts,
--    each with lines) plus the reviewer's edits. It is never joined or
--    filtered on; the relational result of an approval is written to the
--    normal orders / order_lines tables. Keeping it as one document is
--    what makes the review screen and the audit of "what did the AI
--    read vs. what did a human approve" possible.
--
-- 6. Rollback
--    ALTER TABLE public.orders DROP COLUMN IF EXISTS email_intake_id;
--    DROP TABLE IF EXISTS public.email_order_intake;
--    ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_sync_source_check;
--    ALTER TABLE public.orders ADD CONSTRAINT orders_sync_source_check
--      CHECK (sync_source IN ('manual','oms','api','import'));
--    (Only safe once no order has sync_source 'email' or 'fusion'.)
--
-- 7. Affected APIs / services / UI
--    NEW  api/services/emailIntake/{mailbox,extractor,intakeService,poller}.js
--    NEW  api/services/orderCreate.js (shared create path, audit + SSE)
--    NEW  api/routes/emailIntake.js  → /api/email-intake/*
--    NEW  frontend/src/pages/EmailOrdersPage.jsx + services/emailIntakeService.js
--    No change to existing order reads; dbToOrderApi ignores the new column.
--
-- 8. Risks / assumptions
--    - Email bodies are stored for order emails only (status
--      pending_review / created / rejected / error). Non-order emails
--      keep sender + subject only, body NULL.
--    - RLS is enabled with no anon policy: only the service-role API can
--      read/write. The OMS/middleware HTML apps never touch this table.
--    - Assumes public.set_updated_at() exists (added by
--      20260516170000_orders_shipments_updated_at_trigger.sql).
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.email_order_intake (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             text        NOT NULL DEFAULT 'zoree-default',
  source                text        NOT NULL DEFAULT 'imap',
  mailbox               text        NOT NULL,
  message_id            text        NOT NULL,
  from_address          text,
  from_name             text,
  subject               text,
  received_at           timestamptz,
  body_text             text,
  attachment_names      text[]      NOT NULL DEFAULT '{}',
  status                text        NOT NULL DEFAULT 'pending_review',
  is_order_confidence   numeric(4,3),
  extracted             jsonb,
  missing_fields        text[]      NOT NULL DEFAULT '{}',
  error                 text,
  model                 text,
  input_tokens          integer,
  output_tokens         integer,
  reviewed_by           text,
  reviewed_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_order_intake_status_check
    CHECK (status IN ('pending_review','created','rejected','not_order','error')),
  CONSTRAINT email_order_intake_source_check
    CHECK (source IN ('imap','paste')),
  CONSTRAINT email_order_intake_confidence_range
    CHECK (is_order_confidence IS NULL OR (is_order_confidence >= 0 AND is_order_confidence <= 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_order_intake_msg
  ON public.email_order_intake (tenant_id, mailbox, message_id);
CREATE INDEX IF NOT EXISTS idx_email_order_intake_queue
  ON public.email_order_intake (tenant_id, status, received_at DESC);

DROP TRIGGER IF EXISTS trg_email_order_intake_updated_at ON public.email_order_intake;
CREATE TRIGGER trg_email_order_intake_updated_at
  BEFORE UPDATE ON public.email_order_intake
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.email_order_intake ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.email_order_intake IS
  'One row per email the order-intake agent processed. Drafts wait in pending_review until a planner approves (creates orders) or rejects.';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS email_intake_id uuid
    REFERENCES public.email_order_intake(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_email_intake_id
  ON public.orders (email_intake_id) WHERE email_intake_id IS NOT NULL;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_sync_source_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_sync_source_check
  CHECK (sync_source IN ('manual','oms','api','import','fusion','email'));

COMMIT;

NOTIFY pgrst, 'reload schema';
