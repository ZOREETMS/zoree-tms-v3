/* Carrier Bids — constants and factory functions */

export const BID_STATUSES = {
  OPEN: "Open",
  AWARDED: "Awarded",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export const STATUS_COLORS = {
  Open: { bg: "rgba(59,130,246,.1)", color: "var(--accent)", border: "var(--accent)" },
  Awarded: { bg: "var(--green-dim)", color: "var(--green)", border: "var(--green)" },
  Closed: { bg: "#f3f4f6", color: "#374151", border: "#d1d5db" },
  Cancelled: { bg: "var(--red-dim)", color: "var(--red)", border: "var(--red)" },
};

export function emptyRfq() {
  return {
    id: "",
    lane: "",
    volume: "",
    deadline: "",
    status: BID_STATUSES.OPEN,
    responses: [],
  };
}
