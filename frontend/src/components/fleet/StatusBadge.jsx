const STATUS_STYLES = {
  Available: { bg: "var(--green-dim)", color: "var(--green)" },
  "In Transit": { bg: "rgba(59,130,246,.1)", color: "var(--accent)" },
  Maintenance: { bg: "rgba(239,68,68,.1)", color: "var(--red)" },
  "On Duty": { bg: "rgba(59,130,246,.1)", color: "var(--accent)" },
  "Off Duty": { bg: "rgba(107,114,128,.1)", color: "var(--text3)" },
  "Sleeper Berth": { bg: "rgba(124,58,237,.1)", color: "#7c3aed" },
  Inactive: { bg: "rgba(239,68,68,.1)", color: "var(--red)" },
};

export default function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] || { bg: "#f8faff", color: "var(--text3)" };
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
