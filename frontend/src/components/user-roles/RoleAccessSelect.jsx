// ════════════════════════════════════════════════════════════════════
// RoleAccessSelect — single dropdown for the (role × module) cell.
// Replaces the older PermissionTriCell three-checkbox cluster so the
// matrix can fit ~30 modules with minimal horizontal scrolling.
// ════════════════════════════════════════════════════════════════════

const OPTIONS = [
  { value: "edit", label: "Edit",    color: "#0a8754", bg: "#e6f5ed" },
  { value: "view", label: "View",    color: "#b86e00", bg: "#fff5e0" },
  { value: "none", label: "No View", color: "#888888", bg: "#f0f0f0" },
];

export default function RoleAccessSelect({
  level = "none",
  disabled = false,
  rowKey = "",
  colKey = "",
  onChange,
}) {
  const current = OPTIONS.find((o) => o.value === level) || OPTIONS[2];

  return (
    <select
      value={current.value}
      disabled={disabled}
      onChange={(e) => {
        if (disabled) return;
        const next = e.target.value;
        if (next === level) return;
        onChange?.(next);
      }}
      aria-label={`Access level for ${rowKey} on ${colKey}`}
      className="role-access-select"
      style={{
        width: "100%",
        minWidth: 86,
        padding: "4px 6px",
        borderRadius: 6,
        border: `1px solid ${current.color}33`,
        background: disabled ? "#f7f7f7" : current.bg,
        color: disabled ? "#999" : current.color,
        fontWeight: 600,
        fontSize: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        appearance: "auto",
      }}
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
