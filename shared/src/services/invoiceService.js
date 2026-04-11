/**
 * Invoice business logic — variance calculations, stats aggregation,
 * and invoice generation from shipment data.
 */

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
