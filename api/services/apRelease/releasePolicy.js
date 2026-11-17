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
//     manual_exception     only when the customer turned manual exceptions on:
//                          an authorized person accepted a known discrepancy
//                          with a reason, evidence and an explicit amount
//                          confirmation. The failed checks stay on record;
//                          release re-runs the match and refuses anything
//                          that fails beyond the checks that were accepted.
//
//   One authorized person can approve and release. A plain note never
//   bypasses a failed 3-way match: the standard path is a corrected invoice
//   or fixed data, then approve. ('authorized_override' remains only so
//   releases made under the old two-person rule still display.)
//
//   Never releasable: not Approved (On Hold / Disputed / Rejected / Paid),
//   already released, already exported, or a resend of an invoice number
//   already released or exported for the same carrier.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const RELEASE_PATHS = Object.freeze(['validated', 'revalidated', 'authorized_override', 'manual_exception']);
const MIN_MANUAL_REASON = 20;   // the release row requires 20+ characters
const MIN_EVIDENCE = 10;
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

const cents = (n) => Math.round(Number(n || 0) * 100);
const usd = (n) => `$${(cents(n) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Who may approve a manual exception: admins, or the named approvers; anyone who can decide when no list is set. */
function canApproveManualException({ actor, policy }) {
  const list = (policy && policy.exceptionApprovers) || [];
  if (!list.length) return true;
  return Boolean(actor && (actor.isAdmin || list.includes(String(actor.email || '').toLowerCase())));
}

/** The confirmation sentence AP ticks, built from the invoice. */
function manualExceptionConfirmation(invoice) {
  const above = Number(invoice.variance || 0);
  return `Approve ${usd(invoice.invoiced_amount)}${above > 0 ? `, including ${usd(above)} above contract` : ''}`;
}

/**
 * Pure: an authorized person accepting a known discrepancy. Needs the customer's
 * policy on, permission, a reason, evidence, and the exact amount confirmed.
 */
function validateManualException({ invoice, reason, audit, manualException, policy, actor }) {
  const label = invoice.invoice_number || invoice.id;
  if (!policy || !policy.manualExceptions) {
    return { ok: false, status: 409, error: `Manual exceptions are turned off for this customer. ${label} stays on hold until a corrected invoice or a contract update makes it pass.` };
  }
  if (!canApproveManualException({ actor, policy })) {
    return { ok: false, status: 403, error: 'Only an authorized exception approver can approve a manual exception.' };
  }
  if (reason.length < MIN_MANUAL_REASON) {
    return { ok: false, status: 400, error: `A manual exception needs a reason of at least ${MIN_MANUAL_REASON} characters.` };
  }
  const evidence = clean(manualException.evidence);
  if (evidence.length < MIN_EVIDENCE) {
    return { ok: false, status: 400, error: 'A manual exception needs supporting evidence (for example "Email from Bluewater, 11/12, rate increase").' };
  }
  if (manualException.confirmAmount == null || cents(manualException.confirmAmount) !== cents(invoice.invoiced_amount)) {
    return { ok: false, status: 400, error: `Confirm the amount: ${manualExceptionConfirmation(invoice)}.` };
  }
  const failedChecks = (audit.issues || []).map((i) => ({ code: i.code || null, detail: i.detail || null }));
  return { ok: true, decision: 'Approved', reason, manual: { evidence, failedChecks, amount: cents(invoice.invoiced_amount) / 100,
    aboveContract: invoice.variance == null ? null : cents(invoice.variance) / 100, confirmation: manualExceptionConfirmation(invoice) } };
}

/**
 * Validate a person's resolution of a held invoice (approve or dispute).
 * A reviewer can't casually wave an overcharge through: approving needs a
 * written justification, and only On Hold / Pending invoices are open.
 * @returns {{ok:true, decision:'Approved'|'Disputed', reason:string} | {ok:false, error:string, status:number}}
 */
function validateResolution({ invoice, action, justification, audit = null, manualException = null, policy = null, actor = null }) {
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
  if (action === 'approve' && manualException && audit && !PASSING_VERDICTS.has(audit.verdict) && audit.verdict !== 'error') {
    return validateManualException({ invoice, reason: text, audit, manualException, policy, actor });
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
function classify({ invoice, release = null, exportItem = null, takenBillKeys = new Set(), audit = null, manualException = null }) {
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
    if (manualException && audit.verdict !== 'error') {
      const accepted = new Set((manualException.failedChecks || []).map((c) => c.code).filter(Boolean));
      const fresh = (audit.issues || []).filter((i) => !i.code || !accepted.has(i.code));
      if (!fresh.length) {
        return { state: 'awaiting_release', path: 'manual_exception', needsOverride: false, exceptionApprovedBy, manualException: true,
          failedChecks: why, blockers: [] };
      }
      return { state: 'blocked', path: null, needsOverride: false, exceptionApprovedBy,
        blockers: [`A new check fails since the manual exception was approved — ${String(fresh[0].detail || fresh[0].code).replace(/\.+$/, '')}. Review it again.`] };
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
  RELEASE_PATHS, MIN_EXCEPTION_JUSTIFICATION, MIN_MANUAL_REASON, PASSING_VERDICTS,
  isAgentActor, carrierKey, billKey,
  validateResolution, validateManualException, canApproveManualException, manualExceptionConfirmation, classify, decideRelease, selectForExport,
};
