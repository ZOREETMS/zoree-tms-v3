// ════════════════════════════════════════════════════════════════════
// PermissionToggle — segmented Hide / View / Edit pill that replaces
// the old <RoleAccessSelect> dropdown. Values match the existing API
// vocabulary: 'none' | 'view' | 'edit'.
// ════════════════════════════════════════════════════════════════════

const OPTIONS = [
  { v: "none", label: "Hide" },
  { v: "view", label: "View" },
  { v: "edit", label: "Edit" },
];

export default function PermissionToggle({ value = "none", disabled = false, onChange }) {
  const safe = OPTIONS.some((o) => o.v === value) ? value : "none";
  return (
    <div
      className={`acc-perm${disabled ? " locked" : ""}`}
      role="radiogroup"
      aria-label="Permission"
    >
      {OPTIONS.map((o) => {
        const active = safe === o.v;
        return (
          <button
            key={o.v}
            type="button"
            data-v={o.v}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => { if (!disabled && !active) onChange?.(o.v); }}
          >
            <span className="swatch" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
