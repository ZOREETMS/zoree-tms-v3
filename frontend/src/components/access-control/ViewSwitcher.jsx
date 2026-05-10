// ════════════════════════════════════════════════════════════════════
// ViewSwitcher — three-way segmented control for picking which
// representation of the role's permissions to render: the per-role
// Permissions list (default), the cross-role Heatmap, or the full
// power-admin Matrix.
// ════════════════════════════════════════════════════════════════════

const ITEMS = [
  {
    v: "detail",
    label: "Permissions",
    icon: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  },
  {
    v: "heat",
    label: "Heatmap",
    icon:
      '<circle cx="6" cy="6" r="2.5"/><circle cx="12" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/>' +
      '<circle cx="6" cy="12" r="2.5"/><circle cx="12" cy="12" r="2.5"/><circle cx="18" cy="12" r="2.5"/>' +
      '<circle cx="6" cy="18" r="2.5"/><circle cx="12" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/>',
  },
  {
    v: "matrix",
    label: "Matrix",
    icon:
      '<rect x="3" y="3" width="18" height="18" rx="2"/>' +
      '<path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  },
];

export default function ViewSwitcher({ value, onChange }) {
  return (
    <div className="acc-switch" role="tablist" aria-label="View mode">
      {ITEMS.map((it) => (
        <button
          key={it.v}
          type="button"
          aria-pressed={value === it.v}
          onClick={() => onChange?.(it.v)}
        >
          <span
            aria-hidden="true"
            style={{ display: "inline-flex" }}
            dangerouslySetInnerHTML={{
              __html: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${it.icon}</svg>`,
            }}
          />
          {it.label}
        </button>
      ))}
    </div>
  );
}
