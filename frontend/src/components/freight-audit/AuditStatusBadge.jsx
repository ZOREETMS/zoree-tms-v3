import { AUDIT_STATUS_COLORS, PAY_STATUS_COLORS } from "../../types/freightAudit";

export function AuditStatusBadge({ status }) {
  const style = AUDIT_STATUS_COLORS[status] || { color: "var(--text3)", bg: "#f8faff" };
  return (
    <span
      style={{
        background: style.bg,
        color: style.color,
        border: `1px solid ${style.color}`,
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

export function PayStatusBadge({ status }) {
  const style = PAY_STATUS_COLORS[status] || { color: "var(--text3)", bg: "#f8faff" };
  return (
    <span
      style={{
        background: style.bg,
        color: style.color,
        border: `1px solid ${style.color}`,
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 10,
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}
