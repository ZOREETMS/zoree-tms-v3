export const DOC_TYPES = ["BOL", "POD", "Invoice", "Hazmat"];

export const DOC_STATUSES = ["Signed", "Received", "Filed", "Pending", "Sent", "Draft"];

export const DOC_TYPE_LABELS = {
  BOL: "Bill of Lading",
  POD: "Proof of Delivery",
  Invoice: "Commercial Invoice",
  Hazmat: "Hazmat Declaration",
};

export const DOC_TYPE_COLORS = {
  BOL: { color: "var(--accent)", bg: "rgba(59,130,246,.1)" },
  POD: { color: "var(--green)", bg: "var(--green-dim)" },
  Invoice: { color: "#7c3aed", bg: "rgba(124,58,237,.1)" },
  Hazmat: { color: "var(--red)", bg: "rgba(239,68,68,.1)" },
};

export const DOC_STATUS_COLORS = {
  Signed: { color: "var(--green)", bg: "var(--green-dim)" },
  Received: { color: "var(--green)", bg: "var(--green-dim)" },
  Filed: { color: "var(--accent)", bg: "rgba(59,130,246,.1)" },
  Pending: { color: "var(--yellow)", bg: "var(--yellow-dim)" },
  Sent: { color: "var(--accent)", bg: "rgba(59,130,246,.1)" },
  Draft: { color: "var(--text3)", bg: "#f0f4ff" },
};

export function emptyDocument() {
  return {
    id: "",
    type: "BOL",
    ship: "",
    carrier: "",
    generated: "",
    status: "Pending",
  };
}
