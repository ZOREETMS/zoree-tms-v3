// REQ-190 / REQ-191: `Rejected` is a first-class invoice status. The
// backend lifecycle whitelist (EDIT_VALID_STATUSES in api/services/
// invoiceAudit.js) already includes it, and both the auto-decide path
// (decideInvoice) and the manual override path (manualDecide via
// POST /api/invoices/:id/reject) write it. Surfacing it here lets the
// edit-modal status dropdown set it, and gives the table a distinct
// red badge for rejected rows (Disputed is kept separate — disputes are
// adjustments under review; rejections are final).
export const INVOICE_STATUSES = ["Approved", "Pending", "Rejected", "Disputed", "On Hold", "Cancelled"];

export const STATUS_BADGES = {
  Approved:  { bg: "#d1fae5", color: "#064e3b", border: "#6ee7b7", dot: "#059669" },
  Pending:   { bg: "#fef9c3", color: "#713f12", border: "#fde047", dot: "#ca8a04" },
  // REQ-190: deep red for final-rejected so it visually separates from
  // the lighter "Disputed" (which is still adjustable).
  Rejected:  { bg: "#fecaca", color: "#7f1d1d", border: "#f87171", dot: "#b91c1c" },
  Disputed:  { bg: "#fee2e2", color: "#7f1d1d", border: "#fca5a5", dot: "#dc2626" },
  "On Hold": { bg: "#fff7ed", color: "#7c2d12", border: "#fdba74", dot: "#ea580c" },
  Cancelled: { bg: "#f3f4f6", color: "#374151", border: "#d1d5db", dot: "#9ca3af" },
};

export const PAYMENT_TERMS = ["NET15", "NET30", "NET45", "NET60"];

export function emptyInvoice() {
  return {
    num: "",
    carrier: "",
    shipId: "",
    // REQ-187: BOL identifiers — empty array on a fresh form. The
    // direct-from-shipment path inherits these from the shipment of
    // record; manual entry accepts a comma-separated string in the
    // modal that the page normalizes to an array on submit.
    bolIds: [],
    date: new Date().toISOString().slice(0, 10),
    due: "",
    agreed: 0,
    amount: 0,
    status: "Pending",
    paymentTerms: "NET30",
    notes: "",
  };
}
