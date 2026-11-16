-- ═══════════════════════════════════════════════════════════════════
-- 055 — AP release hardening (review findings on 054)
--
-- Why
--   An independent review of 054 found:
--   a) release was two API writes (release row, then audit row) with the
--      invoice read earlier — a status/amount/approval change in between
--      could be released on stale facts (TOCTOU), and a failed audit write
--      could leave a release with no ledger entry;
--   b) duplicate bills (same carrier + invoice number on two invoice rows)
--      were only unique at export, so both could be RELEASED concurrently;
--   c) a batch's CSV was rebuilt on re-download — any config change would
--      make the "same" file differ from what AP imported;
--   d) "AP confirmed import" was an update plus a separate audit insert.
--   Second review round:
--   e) resolving an exception (status change, change_history, AP ledger)
--      was three writes — now one function, ap_resolve_exception;
--   f) segregation of duties compared emails only — the override release
--      now also compares the approver's auth user id (from the ledger);
--   g) ap_demo_reset could run against any domain — now only domains with
--      domains.allow_ap_reset = true (set for the KESTREL_BAY demo pack).
--
-- 1. Schema: invoice_ap_releases + carrier_key, invoice_number_key,
--    released_by_id (auth user id) and UNIQUE(domain, carrier_key,
--    invoice_number_key); ap_export_batches + csv_content, csv_sha256,
--    import_reference; domains + allow_ap_reset. New RPCs ap_release_invoice,
--    ap_resolve_exception, ap_confirm_import; ap_demo_reset guarded;
--    ap_create_export_batch replaced (stores the CSV, checks the number).
-- 2. Migration file: this file. Forward-only.
-- 3. Backfill: none — 054's tables are empty (verified before applying).
-- 4. Indexes: the new UNIQUE constraint is the only one.
-- 5. Constraints: NOT NULL on the new release keys; batch guard extended so
--    csv_content / csv_sha256 never change and import_reference is only set
--    on the exported → import_confirmed transition.
-- 6. Rollback: drop the two new functions, restore 054's
--    ap_create_export_batch and ap_batch_status_guard, drop the new columns.
-- 7. Affected: api/services/apRelease/{index,repository}.js,
--    POST /api/ap/exports/:id/confirm-import (optional reference).
-- 8. Risks: release now fails with 409 if anyone changed the invoice after
--    the revalidation it was based on — intended; the user re-tries.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ── Demo reset only where a domain allows it ──────────────────────
ALTER TABLE public.domains ADD COLUMN IF NOT EXISTS allow_ap_reset boolean NOT NULL DEFAULT false;
UPDATE public.domains SET allow_ap_reset = true, updated_at = now() WHERE code = 'KESTREL_BAY';

CREATE OR REPLACE FUNCTION public.ap_demo_reset(p_domain text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE a integer; b integer; c integer; d integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.domains WHERE code = p_domain AND allow_ap_reset) THEN
    RAISE EXCEPTION 'AP_RESET_REFUSED: % does not allow AP resets (domains.allow_ap_reset)', p_domain USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('zoree.allow_ap_reset', 'on', true);
  DELETE FROM public.ap_export_batch_items WHERE domain_code = p_domain; GET DIAGNOSTICS a = ROW_COUNT;
  DELETE FROM public.ap_export_batches     WHERE domain_code = p_domain; GET DIAGNOSTICS b = ROW_COUNT;
  DELETE FROM public.invoice_ap_releases   WHERE domain_code = p_domain; GET DIAGNOSTICS c = ROW_COUNT;
  DELETE FROM public.ap_audit_events       WHERE domain_code = p_domain; GET DIAGNOSTICS d = ROW_COUNT;
  RETURN jsonb_build_object('items', a, 'batches', b, 'releases', c, 'auditEvents', d);
END $$;

-- ── Atomic exception resolution ───────────────────────────────────
-- Locks the invoice, refuses unless it is still held, sets the decision,
-- writes the change_history rows (built by the API from the same fields
-- the rest of the TMS uses) and the AP ledger entry — one commit.
CREATE OR REPLACE FUNCTION public.ap_resolve_exception(
  p_domain text, p_invoice_id text, p_decision text, p_reason text, p_by text, p_by_id text, p_role text,
  p_history jsonb, p_event_type text, p_detail text, p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE inv public.invoices%ROWTYPE;
BEGIN
  IF p_decision NOT IN ('Approved', 'Disputed') OR p_event_type NOT IN ('exception_approved', 'exception_disputed') THEN
    RAISE EXCEPTION 'AP_RESOLVE_REFUSED: unknown decision %', p_decision USING ERRCODE = 'P0001';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 15 THEN
    RAISE EXCEPTION 'AP_RESOLVE_REFUSED: a written justification of at least 15 characters is required' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO inv FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND OR inv.domain_code <> p_domain THEN
    RAISE EXCEPTION 'AP_RESOLVE_REFUSED: % is not an invoice in %', p_invoice_id, p_domain USING ERRCODE = 'P0001';
  END IF;
  IF inv.status NOT IN ('On Hold', 'Pending') THEN
    RAISE EXCEPTION 'AP_RESOLVE_REFUSED: % is now %; only invoices held for review can be resolved', coalesce(inv.invoice_number, p_invoice_id), inv.status USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.invoices
     SET status = p_decision, decision_reason = btrim(p_reason), decided_at = now(), decided_by = p_by, updated_at = now(),
         sent_to_ap_at = CASE WHEN p_decision = 'Approved' AND sent_to_ap_at IS NULL THEN now() ELSE sent_to_ap_at END,
         sent_to_ap_by = CASE WHEN p_decision = 'Approved' AND sent_to_ap_at IS NULL THEN p_by ELSE sent_to_ap_by END
   WHERE id = p_invoice_id
  RETURNING * INTO inv;

  IF p_history IS NOT NULL AND jsonb_typeof(p_history) = 'array' AND jsonb_array_length(p_history) > 0 THEN
    INSERT INTO public.change_history (entity_type, entity_id, action, field, old_value, new_value, username, user_id, user_role, metadata, tenant_id)
    SELECT h.entity_type, h.entity_id, h.action, h.field, h.old_value, h.new_value, h.username, h.user_id, h.user_role, coalesce(h.metadata, '{}'::jsonb), h.tenant_id
      FROM jsonb_to_recordset(p_history) AS h(entity_type text, entity_id text, action text, field text, old_value text, new_value text,
                                               username text, user_id text, user_role text, metadata jsonb, tenant_id text);
  END IF;

  INSERT INTO public.ap_audit_events (domain_code, invoice_id, event_type, actor, actor_role, detail, payload)
  VALUES (p_domain, p_invoice_id, p_event_type, p_by, p_role, p_detail, coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('actorId', p_by_id));

  RETURN to_jsonb(inv);
END $$;

-- ── Release keys: duplicate bills can't both be released ──────────
ALTER TABLE public.invoice_ap_releases
  ADD COLUMN IF NOT EXISTS carrier_key text NOT NULL,
  ADD COLUMN IF NOT EXISTS invoice_number_key text NOT NULL,
  ADD COLUMN IF NOT EXISTS released_by_id text;
ALTER TABLE public.invoice_ap_releases
  ADD CONSTRAINT ap_release_bill_once UNIQUE (domain_code, carrier_key, invoice_number_key);

-- ── Batch keeps the exact file that left Zoree ─────────────────────
ALTER TABLE public.ap_export_batches
  ADD COLUMN IF NOT EXISTS csv_content text,
  ADD COLUMN IF NOT EXISTS csv_sha256 text,
  ADD COLUMN IF NOT EXISTS import_reference text;

CREATE OR REPLACE FUNCTION public.ap_batch_status_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('zoree.allow_ap_reset', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'ap_export_batches rows cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.id <> OLD.id OR NEW.domain_code <> OLD.domain_code OR NEW.file_name <> OLD.file_name
     OR NEW.invoice_count <> OLD.invoice_count OR NEW.total_amount <> OLD.total_amount
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at OR NEW.target_system <> OLD.target_system
     OR NEW.csv_content IS DISTINCT FROM OLD.csv_content OR NEW.csv_sha256 IS DISTINCT FROM OLD.csv_sha256 THEN
    RAISE EXCEPTION 'ap_export_batches: only the status can change' USING ERRCODE = 'P0001';
  END IF;
  IF NOT (OLD.status = 'exported' AND NEW.status = 'import_confirmed') THEN
    RAISE EXCEPTION 'ap_export_batches: status can only move exported → import_confirmed (was %)', OLD.status USING ERRCODE = 'P0001';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ── Atomic release ────────────────────────────────────────────────
-- Locks the invoice and refuses if anything the revalidation relied on
-- changed (status, amount, who approved it and when). Release row and
-- its ledger entry commit together.
CREATE OR REPLACE FUNCTION public.ap_release_invoice(
  p_domain text, p_invoice_id text, p_path text, p_by text, p_by_id text, p_role text,
  p_note text, p_exception_by text, p_justification text, p_verdict text,
  p_expected_amount numeric, p_expected_decided_by text, p_expected_decided_at timestamptz,
  p_carrier_key text, p_invoice_number_key text, p_event_type text, p_detail text, p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE inv record; rel public.invoice_ap_releases%ROWTYPE;
BEGIN
  SELECT id, status, invoiced_amount, decided_by, decided_at, domain_code INTO inv
    FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND OR inv.domain_code <> p_domain THEN
    RAISE EXCEPTION 'AP_RELEASE_REFUSED: % is not an invoice in %', p_invoice_id, p_domain USING ERRCODE = 'P0001';
  END IF;
  IF inv.status <> 'Approved' THEN
    RAISE EXCEPTION 'AP_RELEASE_REFUSED: % is now %, not Approved — reload and review it', p_invoice_id, inv.status USING ERRCODE = 'P0001';
  END IF;
  IF round(inv.invoiced_amount, 2) <> round(p_expected_amount, 2)
     OR inv.decided_by IS DISTINCT FROM p_expected_decided_by
     OR inv.decided_at IS DISTINCT FROM p_expected_decided_at THEN
    RAISE EXCEPTION 'AP_RELEASE_REFUSED: % changed after it was revalidated — reload and release again', p_invoice_id USING ERRCODE = 'P0001';
  END IF;
  -- Segregation of duties, enforced here too: whoever approved the exception (by auth id or email) can't override-release it.
  IF p_path = 'authorized_override' AND EXISTS (
       SELECT 1 FROM public.ap_audit_events e
        WHERE e.invoice_id = p_invoice_id AND e.event_type = 'exception_approved'
          AND ((p_by_id IS NOT NULL AND e.payload->>'actorId' = p_by_id) OR lower(e.actor) = lower(p_by))) THEN
    RAISE EXCEPTION 'AP_RELEASE_REFUSED: segregation of duties — the person who approved the exception cannot authorize its override release' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.invoice_ap_releases (invoice_id, domain_code, release_path, released_by, released_by_id, note,
    exception_approved_by, override_justification, revalidated_at, revalidation_verdict, amount, carrier_key, invoice_number_key)
  VALUES (p_invoice_id, p_domain, p_path, p_by, p_by_id, nullif(btrim(coalesce(p_note, '')), ''),
    p_exception_by, CASE WHEN p_path = 'authorized_override' THEN btrim(p_justification) END,
    now(), p_verdict, round(inv.invoiced_amount, 2), p_carrier_key, p_invoice_number_key)
  RETURNING * INTO rel;

  INSERT INTO public.ap_audit_events (domain_code, invoice_id, event_type, actor, actor_role, detail, payload)
  VALUES (p_domain, p_invoice_id, p_event_type, p_by, p_role, p_detail, coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('actorId', p_by_id));

  RETURN to_jsonb(rel);
END $$;

-- ── Atomic export (replaces 054's) ─────────────────────────────────
DROP FUNCTION IF EXISTS public.ap_create_export_batch(text, text, text, text, text, jsonb);
CREATE OR REPLACE FUNCTION public.ap_create_export_batch(
  p_domain text, p_batch_id text, p_file_name text, p_created_by text, p_actor_role text, p_items jsonb,
  p_csv text, p_csv_sha256 text
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  it jsonb; inv record; rel record; n integer := 0; total numeric(12,2) := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'AP_EXPORT_EMPTY: nothing to export' USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(p_csv, '') = '' OR coalesce(p_csv_sha256, '') = '' THEN
    RAISE EXCEPTION 'AP_EXPORT_NOT_ELIGIBLE: the CSV and its hash are required' USING ERRCODE = 'P0001';
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT id, status, invoiced_amount, domain_code, invoice_number INTO inv
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
    IF inv.invoice_number IS DISTINCT FROM (it->>'invoice_number') OR rel.carrier_key <> (it->>'carrier_key') THEN
      RAISE EXCEPTION 'AP_EXPORT_NOT_ELIGIBLE: % does not match its release record', inv.id USING ERRCODE = 'P0001';
    END IF;
    IF round(inv.invoiced_amount, 2) <> round((it->>'amount')::numeric, 2) OR round(rel.amount, 2) <> round(inv.invoiced_amount, 2) THEN
      RAISE EXCEPTION 'AP_EXPORT_NOT_ELIGIBLE: % amount changed since release — revalidate and release again', inv.id USING ERRCODE = 'P0001';
    END IF;
    n := n + 1;
    total := total + round(inv.invoiced_amount, 2);
  END LOOP;

  INSERT INTO public.ap_export_batches (id, domain_code, file_name, invoice_count, total_amount, created_by, csv_content, csv_sha256)
  VALUES (p_batch_id, p_domain, p_file_name, n, total, p_created_by, p_csv, p_csv_sha256);

  n := 0;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    n := n + 1;
    SELECT * INTO rel FROM public.invoice_ap_releases WHERE invoice_id = it->>'invoice_id';
    INSERT INTO public.ap_export_batch_items (batch_id, domain_code, invoice_id, line_no, external_id, invoice_number,
      carrier, carrier_key, shipment_ref, invoice_date, due_date, amount, release_path, released_by, released_at)
    VALUES (p_batch_id, p_domain, it->>'invoice_id', n, it->>'external_id', it->>'invoice_number',
      it->>'carrier', rel.carrier_key, nullif(it->>'shipment_ref', ''), nullif(it->>'invoice_date', '')::date,
      nullif(it->>'due_date', '')::date, round((it->>'amount')::numeric, 2), rel.release_path, rel.released_by, rel.released_at);
    INSERT INTO public.ap_audit_events (domain_code, invoice_id, batch_id, event_type, actor, actor_role, detail, payload)
    VALUES (p_domain, it->>'invoice_id', p_batch_id, 'exported', p_created_by, p_actor_role,
      format('Exported %s (%s, $%s) in %s for AP to import into NetSuite', it->>'invoice_number', it->>'carrier',
        to_char(round((it->>'amount')::numeric, 2), 'FM999,999,990.00'), p_batch_id),
      jsonb_build_object('externalId', it->>'external_id', 'releasePath', rel.release_path, 'releasedBy', rel.released_by));
  END LOOP;

  INSERT INTO public.ap_audit_events (domain_code, batch_id, event_type, actor, actor_role, detail, payload)
  VALUES (p_domain, p_batch_id, 'exported', p_created_by, p_actor_role,
    format('Export batch %s created: %s invoice(s), $%s, file SHA-256 %s. NetSuite not written — AP imports the CSV.',
      p_batch_id, n, to_char(total, 'FM999,999,990.00'), left(p_csv_sha256, 12)),
    jsonb_build_object('fileName', p_file_name, 'invoiceCount', n, 'total', total, 'sha256', p_csv_sha256));

  RETURN jsonb_build_object('id', p_batch_id, 'invoiceCount', n, 'total', total, 'fileName', p_file_name, 'sha256', p_csv_sha256);
END $$;

-- ── Atomic "AP imported it" acknowledgement ────────────────────────
CREATE OR REPLACE FUNCTION public.ap_confirm_import(
  p_domain text, p_batch_id text, p_by text, p_role text, p_reference text
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE b public.ap_export_batches%ROWTYPE;
BEGIN
  UPDATE public.ap_export_batches
     SET status = 'import_confirmed', confirmed_by = p_by, confirmed_at = now(),
         import_reference = nullif(btrim(coalesce(p_reference, '')), '')
   WHERE id = p_batch_id AND domain_code = p_domain AND status = 'exported'
  RETURNING * INTO b;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AP_IMPORT_REFUSED: % is not an exported batch in % (already confirmed?)', p_batch_id, p_domain USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.ap_audit_events (domain_code, batch_id, event_type, actor, actor_role, detail, payload)
  VALUES (p_domain, p_batch_id, 'import_confirmed', p_by, p_role,
    format('AP confirmed %s was imported into NetSuite by hand (%s bills, $%s)%s. Zoree did not write to NetSuite.',
      b.file_name, b.invoice_count, to_char(b.total_amount, 'FM999,999,990.00'),
      CASE WHEN b.import_reference IS NOT NULL THEN format(' — NetSuite import reference %s', b.import_reference) ELSE '' END),
    jsonb_build_object('reference', b.import_reference, 'sha256', b.csv_sha256));
  RETURN to_jsonb(b) - 'csv_content';
END $$;

REVOKE ALL ON FUNCTION public.ap_resolve_exception(text, text, text, text, text, text, text, jsonb, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ap_resolve_exception(text, text, text, text, text, text, text, jsonb, text, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.ap_demo_reset(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ap_demo_reset(text) TO service_role;
REVOKE ALL ON FUNCTION public.ap_release_invoice(text, text, text, text, text, text, text, text, text, text, numeric, text, timestamptz, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ap_create_export_batch(text, text, text, text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ap_confirm_import(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ap_release_invoice(text, text, text, text, text, text, text, text, text, text, numeric, text, timestamptz, text, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.ap_create_export_batch(text, text, text, text, text, jsonb, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ap_confirm_import(text, text, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
