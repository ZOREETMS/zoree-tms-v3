import { STATUS_COLORS } from "../../types/carrierBids";

export default function BidStatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.Open;
  return (
    <span
      style={{
        background: c.bg,
        color: c.color,
        border: `1px solid ${c.border}`,
        fontSize: 11,
        fontWeight: 700,
        padding: "2px 9px",
        borderRadius: 20,
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}
