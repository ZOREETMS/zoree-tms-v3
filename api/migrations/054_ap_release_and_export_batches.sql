-- ═══════════════════════════════════════════════════════════════════
-- 054 — AP release, NetSuite export batches, immutable AP audit ledger
--
-- Why
--   Freight Audit already sorts carrier invoices into "ready to post" and
--   "needs review". Until now a clean invoice went straight onto a CSV the
--   browser built, so nothing stopped the same invoice being exported twice
--   and nothing recorded which person released it. During the Kestrel Bay
--   pilot NetSuite is read-only: the agent recommends, a person releases,
--   AP imports a CSV. This migration gives that flow a record:
--
--     invoice_ap_releases    one row per invoice a person released for
--                            export (normal path, revalidated exception,
--                            or authorized override). Append-only.
--     ap_export_batches      one row per NetSuite-ready CSV generated.
--                            Status: exported → import_confirmed (AP's own
--                            acknowledgement; Zoree never writes NetSuite).
--     ap_export_batch_items  the invoices in a batch, snapshotted so the CSV
--                            regenerates byte-for-byte. UNIQUE(invoice_id)
--                            and UNIQUE(domain, carrier, invoice number):
--                            an invoice — or a resend of it — can never be
--                            exported twice. Append-only.
--     ap_audit_events        immutable ledger of every AP decision on the
--                            release/export path (who, when, why).
--     ap_create_export_batch(...)  one transaction: re-checks eligibility
--                            under row locks, writes batch + items + audit.
--     ap_demo_reset(domain)  service-role only: clears a domain's AP rows
--                            for demo/pilot resets (the only way to delete).
--
-- 1. Schema (DDL): 4 tables, 2 trigger functions, 2 RPC functions below.
-- 2. Migration file: this file. Forward-only.
-- 3. Backfill: none. Invoices already Approved by the agent show as
--    "awaiting release" — a person releases them; nothing is auto-released.
-- 4. Indexes: by (domain_code, created_at) for the lists; items by batch;
--    audit by invoice and by batch (the two lookups the UI makes).
-- 5. Constraints: controlled values via CHECK; FKs to invoices (RESTRICT —
--    an exported invoice can't vanish), domains, batches; uniqueness above.
--    Append-only enforced by trigger (UPDATE/DELETE raise), except a batch's
--    status may move exported → import_confirmed once.
-- 6. Rollback: DROP FUNCTION ap_demo_reset, ap_create_export_batch,
--    ap_batch_status_guard, ap_block_mutation; DROP TABLE ap_audit_events,
--    ap_export_batch_items, ap_export_batches, invoice_ap_releases. Safe
--    only before real exports exist — after that, keep the record.
-- 7. Affected: api/services/apRelease/*, api/routes/apRelease.js (/api/ap),
--    domains/domainCodes.js (new tables are domain-scoped),
--    invoiceAudit.deleteInvoice (blocks exported invoices),
--    UI: FreightInvoicesPage tabs "Release & export", "NetSuite preview".
-- 8. Risks / assumptions:
--    - Demo resets that DELETE invoices directly now fail while AP rows
--      reference them: call  select ap_demo_reset('KESTREL_BAY');  first.
--    - NetSuite field mapping (vendor internal IDs, expense account,
--      subsidiary) is not in the data pack: the CSV labels them
--      CONFIG_NEEDED unless NETSUITE_* env values are set.
--    - payload jsonb on ap_audit_events is an event snapshot for the ledger
--      (not relational data); everything queried is a real column.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ── Append-only guard ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ap_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('zoree.allow_ap_reset', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only: rows cannot be %d', TG_TABLE_NAME, lower(TG_OP)
    USING ERRCODE = 'P0001';
END $$;

-- ── Releases ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_ap_releases (
  invoice_id           text PRIMARY KEY REFERENCES public.invoices(id) ON DELETE RESTRICT,
  domain_code          text NOT NULL DEFAULT 'ZOREE' REFERENCES public.domains(code),
  release_path         text NOT NULL CHECK (release_path IN ('validated', 'revalidated', 'authorized_override')),
  released_by          text NOT NULL,
  released_at          timestamptz NOT NULL DEFAULT now(),
  note                 text,
  -- Exception approval this release rests on (null on the normal path).
  exception_approved_by text,
  override_justification text,
  -- Revalidation run at release time (3-way match re-run against live TMS data).
  revalidated_at       timestamptz NOT NULL,
  revalidation_verdict text NOT NULL,
  amount               numeric(12,2) NOT NULL CHECK (amount >= 0),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT override_needs_justification CHECK (
    release_path <> 'authorized_override' OR length(btrim(coalesce(override_justification, ''))) >= 20)
);
CREATE INDEX IF NOT EXISTS idx_invoice_ap_releases_domain ON public.invoice_ap_releases (domain_code, released_at DESC);
DROP TRIGGER IF EXISTS trg_invoice_ap_releases_append_only ON public.invoice_ap_releases;
CREATE TRIGGER trg_invoice_ap_releases_append_only BEFORE UPDATE OR DELETE ON public.invoice_ap_releases
  FOR EACH ROW EXECUTE FUNCTION public.ap_block_mutation();

-- ── Export batches ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ap_export_batches (
  id              text PRIMARY KEY,
  domain_code     text NOT NULL DEFAULT 'ZOREE' REFERENCES public.domains(code),
  status          text NOT NULL DEFAULT 'exported' CHECK (status IN ('exported', 'import_confirmed')),
  target_system   text NOT NULL DEFAULT 'netsuite_csv' CHECK (target_system IN ('netsuite_csv')),
  file_name       text NOT NULL,
  invoice_count   integer NOT NULL CHECK (invoice_count > 0),
  total_amount    numeric(12,2) NOT NULL CHECK (total_amount >= 0),
  created_by      text NOT NULL,
  confirmed_by    text,
  confirmed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ap_export_batches_domain ON public.ap_export_batches (domain_code, created_at DESC);

-- A batch is a record of what left Zoree: only its status may move, once,
-- exported → import_confirmed (AP saying they imported it). Never deleted
-- except by ap_demo_reset.
CREATE OR REPLACE FUNCTION public.ap_batch_status_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('zoree.allow_ap_reset', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'ap_export_batches rows cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.id <> OLD.id OR NEW.domain_code <> OLD.domain_code OR NEW.file_name <> OLD.file_name
     OR NEW.invoice_count <> OLD.invoice_count OR NEW.total_amount <> OLD.total_amount
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at OR NEW.target_system <> OLD.target_system THEN
    RAISE EXCEPTION 'ap_export_batches: only the status can change' USING ERRCODE = 'P0001';
  END IF;
  IF NOT (OLD.status = 'exported' AND NEW.status = 'import_confirmed') THEN
    RAISE EXCEPTION 'ap_export_batches: status can only move exported → import_confirmed (was %)', OLD.status USING ERRCODE = 'P0001';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ap_export_batches_guard ON public.ap_export_batches;
CREATE TRIGGER trg_ap_export_batches_guard BEFORE UPDATE OR DELETE ON public.ap_export_batches
  FOR EACH ROW EXECUTE FUNCTION public.ap_batch_status_guard();

-- ── Export batch items ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ap_export_batch_items (
  id              bigserial PRIMARY KEY,
  batch_id        text NOT NULL REFERENCES public.ap_export_batches(id) ON DELETE RESTRICT,
  domain_code     text NOT NULL DEFAULT 'ZOREE' REFERENCES public.domains(code),
  invoice_id      text NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  line_no         integer NOT NULL CHECK (line_no > 0),
  external_id     text NOT NULL,
  invoice_number  text NOT NULL,
  carrier         text NOT NULL,
  carrier_key     text NOT NULL,
  shipment_ref    text,
  invoice_date    date,
  due_date        date,
  amount          numeric(12,2) NOT NULL CHECK (amount >= 0),
  release_path    text NOT NULL CHECK (release_path IN ('validated', 'revalidated', 'authorized_override')),
  released_by     text NOT NULL,
  released_at     timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ap_export_items_invoice_once UNIQUE (invoice_id),
  CONSTRAINT ap_export_items_number_once  UNIQUE (domain_code, carrier_key, invoice_number),
  CONSTRAINT ap_export_items_external_once UNIQUE (domain_code, external_id),
  CONSTRAINT ap_export_items_line_unique  UNIQUE (batch_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_ap_export_items_batch ON public.ap_export_batch_items (batch_id, line_no);
DROP TRIGGER IF EXISTS trg_ap_export_items_append_only ON public.ap_export_batch_items;
CREATE TRIGGER trg_ap_export_items_append_only BEFORE UPDATE OR DELETE ON public.ap_export_batch_items
  FOR EACH ROW EXECUTE FUNCTION public.ap_block_mutation();

-- ── Immutable AP audit ledger ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ap_audit_events (
  id            bigserial PRIMARY KEY,
  domain_code   text NOT NULL DEFAULT 'ZOREE' REFERENCES public.domains(code),
  invoice_id    text,          -- no FK: the ledger outlives the row it describes
  batch_id      text,
  event_type    text NOT NULL CHECK (event_type IN (
                  'exception_approved', 'exception_disputed', 'revalidated', 'released',
                  'release_blocked', 'override_released', 'exported', 'export_downloaded',
                  'import_confirmed')),
  actor         text NOT NULL,
  actor_role    text,
  detail        text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- event snapshot (justified: ledger, not queried relationally)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ap_audit_has_subject CHECK (invoice_id IS NOT NULL OR batch_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_ap_audit_invoice ON public.ap_audit_events (invoice_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ap_audit_batch   ON public.ap_audit_events (batch_id, created_at) WHERE batch_id IS NOT NULL;
DROP TRIGGER IF EXISTS trg_ap_audit_events_append_only ON public.ap_audit_events;
CREATE TRIGGER trg_ap_audit_events_append_only BEFORE UPDATE OR DELETE ON public.ap_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.ap_block_mutation();

-- ── Atomic export ──────────────────────────────────────────────────
-- p_items: [{invoice_id, external_id, invoice_number, carrier, carrier_key,
--            shipment_ref, invoice_date, due_date, amount}]
-- Release facts are read from invoice_ap_releases, not trusted from the caller.
CREATE OR REPLACE FUNCTION public.ap_create_export_batch(
  p_domain text, p_batch_id text, p_file_name text, p_created_by text, p_actor_role text, p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  it jsonb; inv record; rel record; n integer := 0; total numeric(12,2) := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'AP_EXPORT_EMPTY: nothing to export' USING ERRCODE = 'P0001';
  END IF;

  -- Re-check every invoice under a row lock: still Approved, released, same amount.
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT id, status, invoiced_amount, domain_code INTO inv
      FROM public.invoices WHERE id = it->>'invoice_id' FOR UPDATE;
    IF NOT FOUND OR inv.domain_code <> p_domain THEN
      RAISE EXCEPTION 'AP_EXPORT_NOT_ELIGIBLE: % is not an invoice in %', it->>'invoice_id', p_domain USING ERRCODE = 'P0001';
    END IF;
    IF inv.status <> 'Approved' THEN
      RAISE EXCEPTION 'AP_EXPORT_NOT_ELIGIBLE: % is %, not Approved', inv.id, inv.status USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO rel FROM public.invoice_ap_releases WHERE invoice_id = inv.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AP_EXPORT_NOT_ELIGIBLE: % has not been released by AP', inv.id USING ERRCODE = 'P0001';
    END IF;
    IF round(inv.invoiced_amount, 2) <> round((it->>'amount')::numeric, 2) OR round(rel.amount, 2) <> round(inv.invoiced_amount, 2) THEN
      RAISE EXCEPTION 'AP_EXPORT_NOT_ELIGIBLE: % amount changed since release — revalidate and release again', inv.id USING ERRCODE = 'P0001';
    END IF;
    n := n + 1;
    total := total + round(inv.invoiced_amount, 2);
  END LOOP;

  INSERT INTO public.ap_export_batches (id, domain_code, file_name, invoice_count, total_amount, created_by)
  VALUES (p_batch_id, p_domain, p_file_name, n, total, p_created_by);

  n := 0;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    n := n + 1;
    SELECT * INTO rel FROM public.invoice_ap_releases WHERE invoice_id = it->>'invoice_id';
    INSERT INTO public.ap_export_batch_items (batch_id, domain_code, invoice_id, line_no, external_id, invoice_number,
      carrier, carrier_key, shipment_ref, invoice_date, due_date, amount, release_path, released_by, released_at)
    VALUES (p_batch_id, p_domain, it->>'invoice_id', n, it->>'external_id', it->>'invoice_number',
      it->>'carrier', it->>'carrier_key', nullif(it->>'shipment_ref', ''), nullif(it->>'invoice_date', '')::date,
      nullif(it->>'due_date', '')::date, round((it->>'amount')::numeric, 2), rel.release_path, rel.released_by, rel.released_at);
    INSERT INTO public.ap_audit_events (domain_code, invoice_id, batch_id, event_type, actor, actor_role, detail, payload)
    VALUES (p_domain, it->>'invoice_id', p_batch_id, 'exported', p_created_by, p_actor_role,
      format('Exported %s (%s, $%s) in %s for AP to import into NetSuite', it->>'invoice_number', it->>'carrier',
        to_char(round((it->>'amount')::numeric, 2), 'FM999,999,990.00'), p_batch_id),
      jsonb_build_object('externalId', it->>'external_id', 'releasePath', rel.release_path, 'releasedBy', rel.released_by));
  END LOOP;

  INSERT INTO public.ap_audit_events (domain_code, batch_id, event_type, actor, actor_role, detail, payload)
  VALUES (p_domain, p_batch_id, 'exported', p_created_by, p_actor_role,
    format('Export batch %s created: %s invoice(s), $%s. NetSuite not written — AP imports the CSV.', p_batch_id, n, to_char(total, 'FM999,999,990.00')),
    jsonb_build_object('fileName', p_file_name, 'invoiceCount', n, 'total', total));

  RETURN jsonb_build_object('id', p_batch_id, 'invoiceCount', n, 'total', total, 'fileName', p_file_name);
END $$;

-- ── Demo / pilot reset (service role only) ─────────────────────────
CREATE OR REPLACE FUNCTION public.ap_demo_reset(p_domain text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE a integer; b integer; c integer; d integer;
BEGIN
  PERFORM set_config('zoree.allow_ap_reset', 'on', true);  -- this transaction only
  DELETE FROM public.ap_export_batch_items WHERE domain_code = p_domain; GET DIAGNOSTICS a = ROW_COUNT;
  DELETE FROM public.ap_export_batches     WHERE domain_code = p_domain; GET DIAGNOSTICS b = ROW_COUNT;
  DELETE FROM public.invoice_ap_releases   WHERE domain_code = p_domain; GET DIAGNOSTICS c = ROW_COUNT;
  DELETE FROM public.ap_audit_events       WHERE domain_code = p_domain; GET DIAGNOSTICS d = ROW_COUNT;
  RETURN jsonb_build_object('items', a, 'batches', b, 'releases', c, 'auditEvents', d);
END $$;

-- ── Access: API uses the service role; nothing for anon/authenticated ──
ALTER TABLE public.invoice_ap_releases   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ap_export_batches     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ap_export_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ap_audit_events       ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON FUNCTION public.ap_create_export_batch(text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ap_demo_reset(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ap_create_export_batch(text, text, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.ap_demo_reset(text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
