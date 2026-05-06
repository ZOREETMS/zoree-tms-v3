// ════════════════════════════════════════════════════════════════════
// PermissionTriCell — three mutually-exclusive checkboxes for a single
// (role × module) cell on the User Roles page.
//
// Renders Edit / View / No View as checkboxes (per the requirement
// wording). Behaves like a tri-state radio: ticking one un-ticks the
// other two and emits the new level via onChange.
// ════════════════════════════════════════════════════════════════════

const LEVELS = [
  { key: "edit",  label: "Edit"     },
  { key: "view",  label: "View"     },
  { key: "none",  label: "No View"  },
];

export default function PermissionTriCell({
  level = "none",
  disabled = false,
  onChange,
  rowKey = "",
  colKey = "",
}) {
  const current = LEVELS.find((l) => l.key === level) ? level : "none";

  function handleToggle(nextLevel) {
    if (disabled) return;
    if (nextLevel === current) return;            // no-op
    if (typeof onChange === "function") onChange(nextLevel);
  }

  return (
    <div
      className="perm-tri-cell"
      role="radiogroup"
      aria-label={`Access level for ${rowKey} on ${colKey}`}
      style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}
    >
      {LEVELS.map((opt) => {
        const id = `perm-${rowKey}-${colKey}-${opt.key}`;
        const isChecked = current === opt.key;
        return (
          <label
            key={opt.key}
            htmlFor={id}
            className={`perm-tri-option ${isChecked ? "checked" : ""} ${disabled ? "disabled" : ""}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              color: disabled ? "#999" : isChecked ? "#1a73e8" : "#444",
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            <input
              id={id}
              type="checkbox"
              checked={isChecked}
              disabled={disabled}
              onChange={() => handleToggle(opt.key)}
              aria-checked={isChecked}
              aria-label={`${opt.label} access`}
              style={{ accentColor: "#1a73e8" }}
            />
            {opt.label}
          </label>
        );
      })}
    </div>
  );
}
