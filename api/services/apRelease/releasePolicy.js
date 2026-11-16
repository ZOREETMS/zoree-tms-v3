// ═══════════════════════════════════════════════════════════════════
// AP release policy — who may release which invoice for the NetSuite
// export, and on what basis. Pure: no I/O; every rule is unit-tested.
//
//   The agent recommends, a person releases, AP imports. NetSuite is
//   read-only in the pilot, so "release" means "may go on an export CSV".
//
//   Release paths
//     validated            the agent approved it (3-way match clean) and the
//                          re-run at release time is still clean
//     revalidated          a person approved an exception with a written
//                          justification, and the re-run now passes (e.g.
//                          the missing accessorial approval was added)
//
//   One authorized person can approve and release. A written note never
//   bypasses a failed 3-way match: an exception can only be approved once
//   the re-run passes (corrected invoice, approval added, or contract
//   updated), and the same person may then release it. An invoice whose
//   re-run fails stays blocked until the data is fixed — there is no
//   override path. ('authorized_override' remains only so releases made
//   under the old rule still display.)
//
//   Never releasable: not Approved (On Hold / Disputed / Rejected / Paid),
//   already released, already exported, or a resend of an invoice number
//   already released or exported for the same carrier.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const RELEASE_PATHS = Object.freeze(['validated', 'revalidated', 'authorized_override']);
const MIN_EXCEPTION_JUSTIFICATION = 15;
const PASSING_VERDICTS = new Set(['approve', 'review']); // review = clean but over the auto-approve limit

const AGENT_USERS = new Set(['invoice-intake-agent', 'freight-audit-agent', 'verify-run', 'system']);
/** True when a decision was made by the agent, not a person. */
function isAgentActor(who) {
  if (!who) return true;
  const s = String(who);
  return AGENT_USERS.has(s) || /agent/i.test(s);
}

/** Carrier name as a stable key: "Ridgeline Freight" ≡ "RIDGELINE FREIGHT, LLC" → RIDGELINEFREIGHT. */
function carrierKey(name) {
  return String(name || '').toUpperCase().replace(/\b(INC|LLC|LTD|CORP|CO)\b\.?/g, '').replace(/[^A-Z0-9]/g, '');
}

/** Stable duplicate key for an invoice: same carrier + same invoice number = same bill. */
function billKey(inv) {
  return `${carrierKey(inv.carrier)}|${String(inv.invoice_number || '').trim().toUpperCase()}`;
}

const clean = (s) => String(s || '').trim();

/**
 * Validate a person's resolution of a held invoice (approve or dispute).
 * A reviewer can't casually wave an overcharge through: approving needs a
 * written justification, and only On Hold / Pending invoices are open.
 * @returns {{ok:true, decision:'Approved'|'Disputed', reason:string} | {ok:false, error:string, status:number}}
 */
function validateResolution({ invoice, action, justification, audit = null }) {
  if (!invoice) return { ok: false, status: 404, error: 'Invoice not found in this domain' };
  if (!['approve', 'dispute'].includes(action)) return { ok: false, status: 400, error: `Unknown action '${action}' (approve or dispute)` };
  if (!['On Hold', 'Pending'].includes(invoice.status)) {
    return { ok: false, status: 409, error: `${invoice.invoice_number || invoice.id} is ${invoice.status}; only invoices held for review can be resolved here.` };
  }
  const text = clean(justification);
  if (text.length < MIN_EXCEPTION_JUSTIFICATION) {
    return { ok: false, status: 400, error: action === 'approve'
      ? `Approving an exception needs a written justification (at least ${MIN_EXCEPTION_JUSTIFICATION} characters) — it is kept in the audit history.`
      : `Write what to tell the carrier (at least ${MIN_EXCEPTION_JUSTIFICATION} characters) — it is kept in the audit history.` };
  }
  if (action === 'approve' && (!audit || !PASSING_VERDICTS.has(audit.verdict))) {
    const why = audit ? (audit.issues || []).map((i) => i.detail).filter(Boolean)[0] : null;
    return { ok: false, status: 409, error: `${invoice.invoice_number || invoice.id} still fails the 3-way match${why ? ` — ${String(why).replace(/\.+$/, '')}` : ''}. A note can't approve past a contract mismatch: keep it on hold and dispute it, then approve once a corrected invoice or a contract update makes it pass.` };
  }
  return { ok: true, decision: action === 'approve' ? 'Approved' : 'Disputed', reason: text };
}

/**
 * Pure: where an invoice stands on the release path, and what a release
 * would need. `audit` is the 3-way match re-run against live TMS data
 * (freightAudit.auditOne(...).audit); null when not yet revalidated.
 *
 * @param {object} a
 * @param {object} a.invoice           invoices row
 * @param {object|null} a.release      invoice_ap_releases row
 * @param {object|null} a.exportItem   ap_export_batch_items row
 * @param {Set<string>} [a.takenBillKeys] billKey()s of OTHER invoices already released or exported
 * @param {{verdict:string, issues?:object[]}|null} [a.audit]
 * @returns {{state:'blocked'|'awaiting_release'|'released'|'exported', path:string|null,
 *            needsOverride:boolean, exceptionApprovedBy:string|null, blockers:string[]}}
 */
function classify({ invoice, release = null, exportItem = null, takenBillKeys = new Set(), audit = null }) {
  const label = invoice.invoice_number || invoice.id;
  const exceptionApprovedBy = isAgentActor(invoice.decided_by) ? null : invoice.decided_by;
  if (exportItem) return { state: 'exported', path: release ? release.release_path : exportItem.release_path, needsOverride: false, exceptionApprovedBy, blockers: [] };
  if (release) return { state: 'released', path: release.release_path, needsOverride: false, exceptionApprovedBy, blockers: [] };

  const blockers = [];
  if (invoice.status !== 'Approved') blockers.push(`${label} is ${invoice.status || 'not decided'} — resolve it in the approval queue first.`);
  if (takenBillKeys.has(billKey(invoice))) blockers.push(`${label} from ${invoice.carrier} is already released or exported under another record — a resend is never paid twice.`);
  if (blockers.length) return { state: 'blocked', path: null, needsOverride: false, exceptionApprovedBy, blockers };

  const passes = audit ? PASSING_VERDICTS.has(audit.verdict) : null;
  if (passes === false) {
    const why = (audit.issues || []).map((i) => i.detail).filter(Boolean);
    if (!exceptionApprovedBy) {
      // The agent approved it earlier but the live data no longer matches.
      return { state: 'blocked', path: null, needsOverride: false, exceptionApprovedBy,
        blockers: [`Revalidation failed — ${String(why[0] || 'the 3-way match no longer passes').replace(/\.+$/, '')}. Put it On Hold and review it.`] };
    }
    return { state: 'blocked', path: null, needsOverride: false, exceptionApprovedBy,
      blockers: [`Revalidation fails — ${String(why[0] || 'the 3-way match does not pass').replace(/\.+$/, '')}. A manual approval can't release it: put it On Hold and dispute it, or fix the data, then revalidate.`] };
  }
  const path = exceptionApprovedBy ? 'revalidated' : 'validated';
  return { state: 'awaiting_release', path, needsOverride: false, exceptionApprovedBy, blockers: [] };
}

/**
 * Pure: may this person release this invoice now? Run after revalidation.
 * @param {object} a
 * @param {ReturnType<typeof classify>} a.standing   classify(...) with the fresh audit
 * @returns {{ok:true, path:string} | {ok:false, status:number, error:string}}
 */
function decideRelease({ standing }) {
  if (standing.state === 'exported') return { ok: false, status: 409, error: 'Already exported to NetSuite — it can never be exported again.' };
  if (standing.state === 'released') return { ok: false, status: 409, error: 'Already released — it is waiting on the next export.' };
  if (standing.state === 'blocked') return { ok: false, status: 409, error: standing.blockers.join(' ') };
  return { ok: true, path: standing.path };
}

/**
 * Pure: which released invoices go into the next export. Skips anything
 * already exported (by id or by carrier + invoice number) and drops the
 * second copy of a bill selected twice in the same batch.
 * @param {object[]} released   [{ invoice, release }]
 * @param {object[]} exported   ap_export_batch_items rows already written
 * @param {string[]|null} onlyIds  restrict to these invoice ids
 */
function selectForExport({ released, exported, onlyIds = null }) {
  const doneIds = new Set(exported.map((x) => x.invoice_id));
  const doneKeys = new Set(exported.map((x) => `${x.carrier_key}|${String(x.invoice_number).toUpperCase()}`));
  const want = onlyIds ? new Set(onlyIds) : null;
  const picked = []; const skipped = []; const seen = new Set();
  for (const r of released) {
    const inv = r.invoice;
    if (want && !want.has(inv.id)) continue;
    const key = billKey(inv);
    if (doneIds.has(inv.id) || doneKeys.has(key)) { skipped.push({ invoiceId: inv.id, reason: 'already exported' }); continue; }
    if (seen.has(key)) { skipped.push({ invoiceId: inv.id, reason: 'same carrier invoice number twice in this batch' }); continue; }
    seen.add(key);
    picked.push(r);
  }
  if (want) for (const id of want) if (!released.some((r) => r.invoice.id === id)) skipped.push({ invoiceId: id, reason: 'not released' });
  return { picked, skipped };
}

module.exports = {
  RELEASE_PATHS, MIN_EXCEPTION_JUSTIFICATION, PASSING_VERDICTS,
  isAgentActor, carrierKey, billKey,
  validateResolution, classify, decideRelease, selectForExport,
};
