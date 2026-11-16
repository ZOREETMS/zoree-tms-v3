/**
 * Invoice action service — REQ-190 / REQ-191.
 *
 * Owns the four write actions a finance user can take on an invoice
 * row, plus the DB → UI row mapper that every caller needs:
 *
 *   - manualApprove   POST /api/invoices/:id/approve      (force Approved)
 *   - manualReject    POST /api/invoices/:id/reject       (force Rejected)
 *   - autoDecide      POST /api/invoices/:id/decide       (run carrier-
 *                                                          tolerance check)
 *   - sendToAp        POST /api/invoices/:id/send-to-ap   (mark sent)
 *
 * Why a dedicated service:
 *   CLAUDE_RULES §6/§9 — keep route handlers / page components thin.
 *   Before REQ-191, FreightInvoicesPage inlined every action handler;
 *   adding the third action (Auto Approve) without extracting these
 *   would have pushed the page well past the rule's threshold.
 *
 * Contract:
 *   Every action returns `{ ok, row, decision?, toast }` where
 *     - `row`     is the freshly-mapped UI row to merge into list state
 *                 (null when the action failed),
 *     - `decision` is the server-returned decision payload for
 *                 autoDecide (variance + tolerance breakdown); omitted
 *                 for manual actions,
 *     - `toast`   is `{ text, type }` and `type ∈ {success, warning}`.
 *   Callers do NOT touch the API client directly; they treat the
 *   returned object as the source of truth for UI state changes.
 */

import { InvoicesApi } from "../lib/api";

// ── DB → UI row mapping ─────────────────────────────────────────────
// Used to be inlined in FreightInvoicesPage.jsx. Exported here so every
// caller of the action helpers can reuse it on the row returned from
// each endpoint (the server replies with the raw DB shape).
export function mapDbInvoice(row) {
  if (!row) return null;
  return {
    id: row.id,
    num: row.invoice_number || row.num || "",
    carrier: row.carrier || "",
    shipId: row.shipment_id || row.shipId || "",
    // REQ-07: consolidated invoices have >1 shipment id
    shipIds: Array.isArray(row.shipment_ids) ? row.shipment_ids
            : (row.shipment_id ? [row.shipment_id] : []),
    // REQ-187: BOL identifiers — empty array for legacy rows.
    bolIds: Array.isArray(row.bol_ids) ? row.bol_ids : [],
    date: row.invoice_date || row.date || "",
    due: row.due_date || row.due || "",
    agreed: parseFloat(row.agreed_cost ?? row.agreed_rate ?? row.agreed) || 0,
    amount: parseFloat(row.invoiced_amount ?? row.amount) || 0,
    status: row.status || "Pending",
    paymentTerms: row.payment_terms || "NET30",
    notes: row.notes || "",
    // REQ-06 audit fields surfaced to the UI
    variance: row.variance != null ? parseFloat(row.variance) : null,
    variancePct: row.variance_pct != null ? parseFloat(row.variance_pct) : null,
    tolerancePct: row.tolerance_pct != null ? parseFloat(row.tolerance_pct) : null,
    toleranceAbs: row.tolerance_abs_usd != null ? parseFloat(row.tolerance_abs_usd) : null,
    decisionReason: row.decision_reason || "",
    decidedAt: row.decided_at || null,
    decidedBy: row.decided_by || null,
    sentToApAt: row.sent_to_ap_at || null,
    sentToApBy: row.sent_to_ap_by || null,
    // REQ-191: invoice provenance so the page can offer a Source filter
    source: row.metadata?.source || (row.metadata?.consolidated ? "consolidated" : null),
    // Read from a carrier PDF by Zoree AI → the original can be viewed.
    hasDocument: Boolean(row.metadata?.intake?.file),
    // Read and audited by the AP agent (contract rate, extras, duplicates,
    // sender). The legacy tolerance-only "Auto Approve" is hidden for these.
    readByAgent: Boolean(row.metadata?.intake),
  };
}

// ── Small toast helpers (so callers don't hand-craft strings) ───────
function ok(text)      { return { text, type: "success" }; }
function warn(text)    { return { text, type: "warning" }; }

function fmtMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "$0.00";
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Action: manual approve (REQ-191) ────────────────────────────────
// Force `status='Approved'` regardless of variance. Server auto-stamps
// sent_to_ap_at on first approve. Reason defaults to a generic override
// string so the audit trail is always populated.
export async function manualApprove({ invoice, reason } = {}) {
  if (!invoice || !invoice.id) {
    return { ok: false, row: null, toast: warn("Cannot approve: invoice has no id (local-only row).") };
  }
  try {
    const updated = await InvoicesApi.approve(
      invoice.id,
      reason || "Manual approval — finance override"
    );
    return {
      ok: true,
      row: mapDbInvoice(updated),
      toast: ok(`Invoice ${invoice.num || invoice.id} approved & sent to AP.`),
    };
  } catch (e) {
    return {
      ok: false,
      row: null,
      toast: warn(`Approval failed: ${e?.message || "unknown error"}`),
    };
  }
}

// ── Action: manual reject (REQ-190) ─────────────────────────────────
// Force `status='Rejected'`. Reason is required at the API level — we
// supply a default if the caller didn't capture one. UI typically
// prompts for a reason before calling this.
export async function manualReject({ invoice, reason } = {}) {
  if (!invoice || !invoice.id) {
    return { ok: false, row: null, toast: warn("Cannot reject: invoice has no id (local-only row).") };
  }
  try {
    const updated = await InvoicesApi.reject(
      invoice.id,
      reason || "Manual rejection — finance review"
    );
    return {
      ok: true,
      row: mapDbInvoice(updated),
      toast: warn(`Invoice ${invoice.num || invoice.id} rejected.`),
    };
  } catch (e) {
    return {
      ok: false,
      row: null,
      toast: warn(`Reject failed: ${e?.message || "unknown error"}`),
    };
  }
}

// ── Action: auto-decide (REQ-191 / REQ-184) ─────────────────────────
// Runs the carrier-tolerance comparison server-side. Returns the
// server's decision payload alongside the mapped row so the caller can
// show variance and tolerance numbers in the toast.
export async function autoDecide({ invoice } = {}) {
  if (!invoice || !invoice.id) {
    return { ok: false, row: null, toast: warn("Cannot auto-approve: invoice has no id.") };
  }
  try {
    const res = await InvoicesApi.decide(invoice.id);
    const d = res?.decision || {};
    const row = mapDbInvoice(res?.invoice);
    const varianceTxt = d.variance != null
      ? ` (variance ${fmtMoney(d.variance)} vs ±${fmtMoney(d.toleranceAbs ?? 0)} / ±${Number(d.tolerancePct ?? 0)}%)`
      : "";
    const message = d.status === "Approved"
      ? `Approved${d.sentToAp ? " & sent to AP" : ""}${varianceTxt} — ${d.reason || ""}`
      : `Rejected${varianceTxt} — ${d.reason || ""}`;
    return {
      ok: true,
      row,
      decision: d,
      toast: d.status === "Approved" ? ok(message) : warn(message),
    };
  } catch (e) {
    return {
      ok: false,
      row: null,
      toast: warn(`Auto-approve failed: ${e?.message || "unknown error"}`),
    };
  }
}

// ── Action: delete invoice (REQ-192) ────────────────────────────────
// Hard delete via DELETE /api/invoices/:id. The backend service writes
// a 'delete' audit row on the invoice and a mirroring row on each
// linked shipment BEFORE removing the row, so the audit trail survives
// the delete even though the invoice row doesn't. Returns the deleted
// row id (not a row object) so callers can filter list state.
export async function deleteInvoice({ invoice, reason } = {}) {
  if (!invoice || !invoice.id) {
    return { ok: false, removedId: null, toast: warn("Cannot delete: invoice has no id (local-only row).") };
  }
  try {
    await InvoicesApi.remove(invoice.id, reason);
    return {
      ok: true,
      removedId: invoice.id,
      toast: ok(`Invoice ${invoice.num || invoice.id} deleted.`),
    };
  } catch (e) {
    return {
      ok: false,
      removedId: null,
      toast: warn(`Delete failed: ${e?.message || "unknown error"}`),
    };
  }
}

// ── Action: send to AP (carried over so the page handler can shrink too) ─
export async function sendToAp({ invoice } = {}) {
  if (!invoice || !invoice.id) {
    return { ok: false, row: null, toast: warn("Cannot send to AP: invoice has no id.") };
  }
  try {
    const updated = await InvoicesApi.sendToAp(invoice.id);
    return {
      ok: true,
      row: mapDbInvoice(updated),
      toast: ok(`Invoice ${invoice.num || invoice.id} sent to AP.`),
    };
  } catch (e) {
    return {
      ok: false,
      row: null,
      toast: warn(`Send-to-AP failed: ${e?.message || "unknown error"}`),
    };
  }
}

// ── Visibility predicates (kept here so the table + modal agree) ────
// The buttons disappear once the invoice is in a final state for that
// action. Centralizing avoids drift between the two render sites.
export function canManualApprove(status) {
  return status !== "Approved" && status !== "Paid";
}
export function canManualReject(status) {
  return status !== "Rejected" && status !== "Paid";
}

// Payment integrity (Nov 2026) — mirrors the server rules in
// invoiceAudit.assertEditAllowed / deleteInvoice / invoiceCostLines:
// an Approved or Paid invoice is what AP pays, so its money fields and
// lines are locked, it can't be deleted, and the edit form can't approve.
// Once sent to AP an invoice stays locked even if moved On Hold or
// rejected: the ERP may already have it.
export function isLockedForEdit(status, sentToApAt = null) {
  return status === "Approved" || status === "Paid" || Boolean(sentToApAt);
}
export function canDelete(status, sentToApAt = null) {
  return !isLockedForEdit(status, sentToApAt);
}
export function lockedHint(status, sentToApAt = null) {
  if (status === "Paid") return "Paid — this invoice is closed.";
  if (sentToApAt) return "Sent to AP — amounts, shipment and cost lines are locked. Reject it and ask the carrier for a corrected invoice.";
  if (status === "Approved") return "Approved — amounts, shipment and cost lines are locked. Set Status to On Hold to change them.";
  return null;
}
/** Which statuses the edit form's Status dropdown may move to from `current`. */
export function statusOptionAllowed(current, option) {
  if (option === current) return true;
  if (current === "Paid") return false;
  if (option === "Approved") return false;          // use the Approve button
  if (option === "Paid") return current === "Approved";
  return true;
}
export function canAutoDecide(status, invoice) {
  // REQ-191: Auto Approve must be available on EVERY non-terminal
  // invoice — not just the initial Pending/On Hold/Disputed ones.
  //
  // Why: integration-imported invoices and manually-created invoices
  // both flow through invoiceAudit.submitInvoice, which auto-decides
  // them on creation (status is set to 'Approved' or 'Rejected'
  // immediately). With the old predicate the Auto button never showed
  // on those rows, so finance couldn't re-run the carrier-tolerance
  // comparison after a shipment cost was corrected, after the carrier's
  // tolerance was adjusted, or after a cost line was edited.
  //
  // Only 'Cancelled' is truly terminal — re-running a tolerance check
  // on a voided invoice is meaningless. 'Rejected', 'Pending',
  // 'On Hold', and 'Disputed' all permit a re-decide.
  //
  // Nov 2026: hidden on 'Approved' too — an "Auto Approve" button on an
  // invoice that is already approved reads as a mistake to AP. To re-check
  // an approved invoice after an edit, put it On Hold first.
  //
  // Nov 2026: hidden on invoices the AP agent read from a carrier PDF. The
  // legacy check only compares the total against the shipment cost; it
  // ignores duplicates, unapproved extras and sender checks, so it could
  // approve a resend the agent held (double payment). AP approves or
  // disputes those with the manual buttons after reading the agent's reason.
  if (invoice && invoice.readByAgent) return false;
  return status !== "Cancelled" && status !== "Paid" && status !== "Approved";
}
