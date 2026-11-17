-- ═══════════════════════════════════════════════════════════════════
-- 057_ap_manual_exception_path.sql
-- ─────────────────────────────────────────────────────────────────────
-- Why: a customer may agree that an authorized AP user can accept a known
-- discrepancy (e.g. BW-5521, $122 above contract) instead of waiting for a
-- corrected invoice. That is a business decision, not a passing match, so
-- it gets its own release path and keeps the failed checks on record.
-- Off unless FREIGHT_AUDIT_MANUAL_EXCEPTIONS=on. The same authorized user
-- may approve and release it (unlike authorized_override, which keeps
-- segregation of duties).
--
-- 1. Schema changes (DDL)
--    ~ invoice_ap_releases.release_path   + 'manual_exception'
--    ~ ap_export_batch_items.release_path + 'manual_exception'
--    ~ function ap_release_invoice: refuses 'manual_exception' unless an
--      exception_approved event with payload.manualException = true exists;
--      stores the justification for this path too.
--    No new tables or columns.
-- 2. Migration file: this file. Forward-only.
-- 3. Backfill / data migration: none — existing rows keep their path.
-- 4. Index changes: none.
-- 5. Constraint changes: the two release_path CHECKs are replaced with the
--    wider list; override_needs_justification now covers manual_exception
--    (justification of 20+ characters required for both).
-- 6. Rollback: forward-only. The old CHECKs can be restored only while no
--    row has release_path = 'manual_exception'; switching the feature off
--    (FREIGHT_AUDIT_MANUAL_EXCEPTIONS=off) needs no schema change.
-- 7. Affected: services/apRelease (policy + service), routes/apRelease,
--    agents/freightAudit/apPolicy, invoiceIntake/intakeDetail, the review
--    drawer and release list in the frontend, apRelease tests.
-- 8. Risks / assumptions: approvers are admins or the emails in
--    FREIGHT_AUDIT_OVERRIDE_APPROVERS (anyone who can edit invoices when
--    that list is empty); evidence is a text reference, not an uploaded
--    file; release still re-runs the 3-way match and refuses any failure
--    beyond the checks that were accepted.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.invoice_ap_releases DROP CONSTRAINT IF EXISTS invoice_ap_releases_release_path_check;
ALTER TABLE public.invoice_ap_releases ADD CONSTRAINT invoice_ap_releases_release_path_check
  CHECK (release_path IN ('validated', 'revalidated', 'authorized_override', 'manual_exception'));

ALTER TABLE public.invoice_ap_releases DROP CONSTRAINT IF EXISTS override_needs_justification;
ALTER TABLE public.invoice_ap_releases ADD CONSTRAINT override_needs_justification
  CHECK (release_path NOT IN ('authorized_override', 'manual_exception') OR length(btrim(coalesce(override_justification, ''))) >= 20);

ALTER TABLE public.ap_export_batch_items DROP CONSTRAINT IF EXISTS ap_export_batch_items_release_path_check;
ALTER TABLE public.ap_export_batch_items ADD CONSTRAINT ap_export_batch_items_release_path_check
  CHECK (release_path IN ('validated', 'revalidated', 'authorized_override', 'manual_exception'));

-- ── Atomic release (replaces 055's; adds the manual_exception guard) ──
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

  -- A manual exception releases only if a person recorded one: an exception_approved
  -- event for this invoice with payload.manualException = true.
  IF p_path = 'manual_exception' AND NOT EXISTS (
       SELECT 1 FROM public.ap_audit_events e
        WHERE e.invoice_id = p_invoice_id AND e.event_type = 'exception_approved'
          AND coalesce((e.payload->>'manualException')::boolean, false)) THEN
    RAISE EXCEPTION 'AP_RELEASE_REFUSED: % has no recorded manual-exception approval', p_invoice_id USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.invoice_ap_releases (invoice_id, domain_code, release_path, released_by, released_by_id, note,
    exception_approved_by, override_justification, revalidated_at, revalidation_verdict, amount, carrier_key, invoice_number_key)
  VALUES (p_invoice_id, p_domain, p_path, p_by, p_by_id, nullif(btrim(coalesce(p_note, '')), ''),
    p_exception_by, CASE WHEN p_path IN ('authorized_override', 'manual_exception') THEN btrim(p_justification) END,
    now(), p_verdict, round(inv.invoiced_amount, 2), p_carrier_key, p_invoice_number_key)
  RETURNING * INTO rel;

  INSERT INTO public.ap_audit_events (domain_code, invoice_id, event_type, actor, actor_role, detail, payload)
  VALUES (p_domain, p_invoice_id, p_event_type, p_by, p_role, p_detail, coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('actorId', p_by_id));

  RETURN to_jsonb(rel);
END $$;

REVOKE ALL ON FUNCTION public.ap_release_invoice(text, text, text, text, text, text, text, text, text, text, numeric, text, timestamptz, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ap_release_invoice(text, text, text, text, text, text, text, text, text, text, numeric, text, timestamptz, text, text, text, text, jsonb) TO service_role;

COMMIT;
