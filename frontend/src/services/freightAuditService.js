import { AUDIT_STATUS, PAY_STATUS } from "../types/freightAudit";
import { InvoicesApi } from "../lib/api";
import { mapDbInvoice, manualApprove } from "./invoiceActionsService";
import { runAgent } from "./agentsService";

export function computeAuditKpis(records) {
  const total = records.length;
  const matched = records.filter((r) => r.auditStatus === AUDIT_STATUS.MATCHED).length;
  const discrepancies = records.filter((r) => r.auditStatus === AUDIT_STATUS.DISCREPANCY).length;
  const pendingReview = records.filter((r) => r.payStatus === PAY_STATUS.PENDING || r.payStatus === PAY_STATUS.ON_HOLD).length;

  const recovered = records
    .filter((r) => r.auditStatus === AUDIT_STATUS.DISCREPANCY)
    .reduce((sum, r) => sum + Math.abs(r.billed - r.agreed), 0);

  return { total, matched, discrepancies, pendingReview, recovered };
}

export function computeVariance(agreed, billed) {
  return billed - agreed;
}

export function formatVariance(variance) {
  if (variance === 0) return "$0";
  const prefix = variance > 0 ? "+$" : "-$";
  return prefix + Math.abs(variance).toLocaleString();
}

// ── Real data (no sample rows) ──────────────────────────────────────
// The audit queue is the invoices of the active domain. Agreed = the
// rated shipment cost, billed = what the carrier invoiced.

const HELD = new Set(["On Hold", "Rejected", "Disputed", "Cancelled"]);
const PAY_BY_STATUS = {
  Approved: PAY_STATUS.APPROVED, Paid: PAY_STATUS.APPROVED,
  "On Hold": PAY_STATUS.ON_HOLD,
  Disputed: PAY_STATUS.DISPUTED, Rejected: PAY_STATUS.DISPUTED, Cancelled: PAY_STATUS.DISPUTED,
};

/** One invoice (already through mapDbInvoice) → one audit queue row. */
export function toAuditRecord(inv) {
  const agreed = Number(inv.agreed) || 0;
  const billed = Number(inv.amount) || 0;
  const hasVariance = Math.abs(billed - agreed) >= 0.01;
  const auditStatus = !agreed && !HELD.has(inv.status) ? AUDIT_STATUS.PENDING
    : (hasVariance || HELD.has(inv.status)) ? AUDIT_STATUS.DISCREPANCY
    : AUDIT_STATUS.MATCHED;
  return {
    id: inv.id,
    inv: inv.num || inv.id,
    carrier: inv.carrier,
    ship: (inv.shipIds && inv.shipIds.length ? inv.shipIds : [inv.shipId]).filter(Boolean).join(", "),
    agreed,
    billed,
    issue: auditStatus === AUDIT_STATUS.DISCREPANCY ? (inv.decisionReason || "") : "",
    auditStatus,
    payStatus: PAY_BY_STATUS[inv.status] || PAY_STATUS.PENDING,
    invoice: inv,
  };
}

export async function loadAuditRecords() {
  const data = await InvoicesApi.list();
  const rows = Array.isArray(data?.invoices) ? data.invoices : Array.isArray(data) ? data : [];
  return rows.map(mapDbInvoice).filter(Boolean).map(toAuditRecord);
}

const done = (row, text, type) => ({ ok: true, record: toAuditRecord(row), toast: { text, type } });
const failed = (text) => ({ ok: false, record: null, toast: { text, type: "warning" } });

export async function approveRecord(record) {
  const r = await manualApprove({ invoice: record.invoice, reason: "Approved in Freight Audit" });
  return r.ok ? done(r.row, `${record.inv} approved for payment`, "success") : failed(r.toast.text);
}

async function setStatus(record, status, text, type) {
  try {
    const row = mapDbInvoice(await InvoicesApi.update(record.id, { status }));
    return done(row, text, type);
  } catch (e) {
    return failed(`${record.inv}: ${e?.message || "update failed"}`);
  }
}

export const disputeRecord = (record) => setStatus(record, "Disputed", `${record.inv} marked as disputed`, "warning");
export const releaseRecord = (record) => setStatus(record, "Pending", `${record.inv} released — pending approval`, "info");

/** Line-level audit of held invoices by the Freight Audit agent. Its proposed actions wait for a person in AI Agents. */
export async function runAutoAudit() {
  const run = await runAgent("freight_audit", { scan: true, limit: 25 });
  return run?.summary || "Audit complete.";
}
