/**
 * Invoice business logic — variance calculations, stats aggregation,
 * and invoice generation from shipment data.
 */

// QA bug #257: web's FreightInvoicesPage applies a DB→UI row mapper
// (frontend/src/services/invoiceActionsService.js::mapDbInvoice) at load
// time before feeding rows into useInvoices. Mobile's InvoicesScreen
// historically skipped that step — it took the raw DataContext rows
// (snake_case from /api/db/invoices) and passed them straight to the
// shared useInvoices hook. The hook reads `i.amount`, `i.agreed`,
// `i.num`, `i.shipId`, etc.; the DB rows expose `invoiced_amount`,
// `agreed_cost`, `invoice_number`, `shipment_id`. Result: every dollar
// total on the mobile dashboard rolled up to $0, search by invoice
// number found nothing, and the detail view rendered blank fields —
// while web showed correct numbers from the same data. Exposing the
// mapper here (kept byte-for-byte aligned with the web version) lets
// InvoicesScreen normalize at the consumer edge without poking
// DataContext, which is shared with many other screens that already
// work fine on the raw shape.
export function mapDbInvoice(row) {
  if (!row) return null;
  return {
    id:           row.id,
    num:          row.invoice_number || row.num || "",
    carrier:      row.carrier || "",
    shipId:       row.shipment_id || row.shipId || "",
    shipIds:      Array.isArray(row.shipment_ids) ? row.shipment_ids
                : (row.shipment_id ? [row.shipment_id] : []),
    bolIds:       Array.isArray(row.bol_ids) ? row.bol_ids : [],
    date:         row.invoice_date || row.date || "",
    due:          row.due_date     || row.due  || "",
    agreed:       parseFloat(row.agreed_cost     ?? row.agreed_rate ?? row.agreed) || 0,
    amount:       parseFloat(row.invoiced_amount ?? row.amount)                    || 0,
    status:       row.status || "Pending",
    paymentTerms: row.payment_terms || "NET30",
    notes:        row.notes || "",
    variance:     row.variance     != null ? parseFloat(row.variance)     : null,
    variancePct:  row.variance_pct != null ? parseFloat(row.variance_pct) : null,
    tolerancePct: row.tolerance_pct     != null ? parseFloat(row.tolerance_pct)     : null,
    toleranceAbs: row.tolerance_abs_usd != null ? parseFloat(row.tolerance_abs_usd) : null,
    decisionReason: row.decision_reason || "",
    decidedAt:      row.decided_at || null,
    decidedBy:      row.decided_by || null,
    sentToApAt:     row.sent_to_ap_at || null,
    sentToApBy:     row.sent_to_ap_by || null,
    source:         row.metadata?.source || (row.metadata?.consolidated ? "consolidated" : null),
  };
}

// Guard for the screen consumer: if a row already looks UI-shaped
// (camelCase keys present), pass it through; otherwise normalize.
// This makes the mapper idempotent so the screen can call it
// unconditionally without double-mapping invoices that some other
// path may have already normalized.
export function ensureUiInvoice(row) {
  if (!row) return null;
  if (row.num !== undefined && row.amount !== undefined && row.agreed !== undefined) {
    return row;
  }
  return mapDbInvoice(row);
}

export function computeVariance(agreed, invoiced) {
  return invoiced - agreed;
}

export function computeStats(invoices) {
  const approved = invoices.filter((i) => i.status === "Approved");
  const pending = invoices.filter((i) => i.status === "Pending");
  const disputed = invoices.filter((i) => i.status === "Disputed");

  const approvedTotal = approved.reduce((s, i) => s + (i.amount || 0), 0);
  const pendingTotal = pending.reduce((s, i) => s + (i.amount || 0), 0);
  const disputedTotal = disputed.reduce((s, i) => s + (i.amount || 0), 0);

  const totalAgreed = invoices.reduce((s, i) => s + (i.agreed || 0), 0);
  const totalInvoiced = invoices.reduce((s, i) => s + (i.amount || 0), 0);
  const auditSavings = totalAgreed > 0
    ? ((totalInvoiced - totalAgreed) / totalAgreed) * 100
    : 0;
  const auditSavingsAmt = Math.abs(totalInvoiced - totalAgreed);

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
