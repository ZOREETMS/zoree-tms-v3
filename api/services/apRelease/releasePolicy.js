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
//     authorized_override  a person approved an exception, the re-run still
//                          fails, and an authorized approver (admin, or a
//                          named override approver) who is NOT the person
//                          who approved the exception releases it with a
//                          justification of 20+ characters
//
//   Never releasable: not Approved (On Hold / Disputed / Rejected / Paid),
//   already released, already exported, or a resend of an invoice number
//   already released or exported for the same carrier.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const RELEASE_PATHS = Object.freeze(['validated', 'revalidated', 'authorized_override']);
const MIN_EXCEPTION_JUSTIFICATION = 15;
const MIN_OVERRIDE_JUSTIFICATION = 20;
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
 * Who may authorize an override release.
 * @param {{isAdmin:boolean, email?:string, env?:object}} a
 */
function canAuthorizeOverride({ isAdmin, email, env = process.env }) {
  if (isAdmin) return true;
  const list = String(env.FREIGHT_AUDIT_OVERRIDE_APPROVERS || '').split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  return Boolean(email) && list.includes(String(email).toLowerCase());
}

/**
 * Validate a person's resolution of a held invoice (approve or dispute).
 * A reviewer can't casually wave an overcharge through: approving needs a
 * written justification, and only On Hold / Pending invoices are open.
 * @returns {{ok:true, decision:'Approved'|'Disputed', reason:string} | {ok:false, error:string, status:number}}
 */
function validateResolution({ invoice, action, justification }) {
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
        blockers: [`Revalidation failed — ${why[0] || 'the 3-way match no longer passes'}. Put it On Hold and review it.`] };
    }
    return { state: 'awaiting_release', path: 'authorized_override', needsOverride: true, exceptionApprovedBy,
      blockers: [`Revalidation still fails — ${String(why[0] || 'the 3-way match does not pass').replace(/\.+$/, '')}. Only an authorized override can release it.`] };
  }
  const path = exceptionApprovedBy ? 'revalidated' : 'validated';
  return { state: 'awaiting_release', path, needsOverride: false, exceptionApprovedBy, blockers: [] };
}

/**
 * Pure: may this person release this invoice now? Run after revalidation.
 * @param {object} a
 * @param {ReturnType<typeof classify>} a.standing   classify(...) with the fresh audit
 * @param {{email:string, isAdmin:boolean}} a.actor
 * @param {{justification?:string}|null} [a.override]
 * @returns {{ok:true, path:string} | {ok:false, status:number, error:string}}
 */
function decideRelease({ standing, actor, override = null, env = process.env }) {
  if (standing.state === 'exported') return { ok: false, status: 409, error: 'Already exported to NetSuite — it can never be exported again.' };
  if (standing.state === 'released') return { ok: false, status: 409, error: 'Already released — it is waiting on the next export.' };
  if (standing.state === 'blocked') return { ok: false, status: 409, error: standing.blockers.join(' ') };
  if (!standing.needsOverride) return { ok: true, path: standing.path };

  if (!override) return { ok: false, status: 409, error: standing.blockers.join(' ') };
  if (!canAuthorizeOverride({ isAdmin: actor.isAdmin, email: actor.email, env })) {
    return { ok: false, status: 403, error: 'Only an authorized approver (admin or a named override approver) can override a failed revalidation.' };
  }
  if (standing.exceptionApprovedBy && String(standing.exceptionApprovedBy).toLowerCase() === String(actor.email || '').toLowerCase()) {
    return { ok: false, status: 403, error: 'Segregation of duties: the person who approved the exception cannot also authorize its override release.' };
  }
  if (clean(override.justification).length < MIN_OVERRIDE_JUSTIFICATION) {
    return { ok: false, status: 400, error: `An override needs a justification of at least ${MIN_OVERRIDE_JUSTIFICATION} characters.` };
  }
  return { ok: true, path: 'authorized_override' };
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
  RELEASE_PATHS, MIN_EXCEPTION_JUSTIFICATION, MIN_OVERRIDE_JUSTIFICATION,
  isAgentActor, carrierKey, billKey, canAuthorizeOverride,
  validateResolution, classify, decideRelease, selectForExport,
};
