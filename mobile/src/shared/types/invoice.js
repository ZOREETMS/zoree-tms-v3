export const INVOICE_STATUSES = ["Approved", "Pending", "Disputed", "On Hold", "Cancelled"];

export const STATUS_BADGES = {
  Approved:  { bg: "#d1fae5", color: "#064e3b", border: "#6ee7b7", dot: "#059669" },
  Pending:   { bg: "#fef9c3", color: "#713f12", border: "#fde047", dot: "#ca8a04" },
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
    date: new Date().toISOString().slice(0, 10),
    due: "",
    agreed: 0,
    amount: 0,
    status: "Pending",
    paymentTerms: "NET30",
    notes: "",
  };
}
