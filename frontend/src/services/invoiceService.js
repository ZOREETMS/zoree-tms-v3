/**
 * Invoice business logic — variance calculations, stats aggregation,
 * and invoice generation from shipment data.
 */

export function computeVariance(agreed, invoiced) {
  return invoiced - agreed;
}

/** A decision reason without the agent's tag, for showing in lists. */
export function readableReason(reason) {
  return String(reason || "")
    .replace(/^\[Zoree AI[^\]]*\]\s*/, "")
    .replace(/^Needs AP review:\s*/i, "")
    .trim();
}

export function computeStats(invoices) {
  const approved = invoices.filter((i) => i.status === "Approved");
  // Waiting on a person: never decided, or held by the agent.
  const pending = invoices.filter((i) => i.status === "Pending" || i.status === "On Hold");
  const disputed = invoices.filter((i) => i.status === "Disputed");

  const approvedTotal = approved.reduce((s, i) => s + (i.amount || 0), 0);
  const pendingTotal = pending.reduce((s, i) => s + (i.amount || 0), 0);
  const disputedTotal = disputed.reduce((s, i) => s + (i.amount || 0), 0);

  // Overbilling flagged: billed above the agreed cost, only where an agreed
  // cost exists (an invoice with no shipment has nothing to compare with).
  const rated = invoices.filter((i) => (i.agreed || 0) > 0);
  const totalAgreed = rated.reduce((s, i) => s + i.agreed, 0);
  const auditSavingsAmt = rated.reduce((s, i) => s + Math.max(0, (i.amount || 0) - i.agreed), 0);
  const auditSavings = totalAgreed > 0 ? (auditSavingsAmt / totalAgreed) * 100 : 0;

  return {
    approvedTotal,
    approvedCount: approved.length,
    pendingTotal,
    pendingCount: pending.length,
    disputedTotal,
    disputedCount: disputed.length,
    auditSavingsPct: Math.abs(auditSavings).toFixed(1),
    auditSavingsAmt,
  };
}

export function generateInvoiceNum() {
  const seq = Math.floor(10000 + Math.random() * 90000);
  return `INV-${seq}`;
}

export function computeDueDate(invoiceDate, terms = "NET30") {
  const days = parseInt(terms.replace("NET", ""), 10) || 30;
  const d = new Date(invoiceDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── REQ-186: cost-line helpers ─────────────────────────────────────
// Pure formatting + aggregation logic so the InvoiceCostLines component
// stays as a thin renderer (CLAUDE_RULES rule 6 — no large logic blocks
// in components).

export const COST_TYPE_LABELS = Object.freeze({
  base:           "Base Rate",
  fuel_surcharge: "Fuel Surcharge",
  accessorial:    "Accessorial",
  discount:       "Discount",
  other:          "Other",
});

export function costTypeLabel(type) {
  return COST_TYPE_LABELS[type] || type || "—";
}

export function sumApprovedCosts(lines) {
  if (!Array.isArray(lines)) return 0;
  return lines.reduce((s, l) => s + (Number(l.approved_cost) || 0), 0);
}

export function sumInvoiceCosts(lines) {
  if (!Array.isArray(lines)) return 0;
  return lines.reduce((s, l) => s + (Number(l.invoice_cost) || 0), 0);
}

// Variance for a single line: approved − invoice. Negative means
// finance approved less than the carrier billed (typical), positive
// means finance is approving more (rare; usually means the operator
// also discovered a missed charge to add back).
export function lineVariance(line) {
  const inv = Number(line?.invoice_cost) || 0;
  const apr = Number(line?.approved_cost) || 0;
  return Math.round((apr - inv) * 100) / 100;
}
