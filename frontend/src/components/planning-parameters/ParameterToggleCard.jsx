export default function ParameterToggleCard({ parameter, onToggle, saving }) {
  const { id, label, description, category, enabled } = parameter;

  return (
    <div className="card" style={{ padding: "20px", marginBottom: "12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <span style={{ fontWeight: 600, fontSize: "14px" }}>{label}</span>
            {category && (
              <span className="badge" style={{ fontSize: "10px", textTransform: "uppercase" }}>
                {category}
              </span>
            )}
          </div>
          {description && (
            <div className="text-muted" style={{ fontSize: "12.5px", lineHeight: 1.5 }}>
              {description}
            </div>
          )}
        </div>

        <label
          style={{
            position: "relative",
            display: "inline-block",
            width: "44px",
            height: "24px",
            flexShrink: 0,
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.5 : 1,
          }}
        >
          <input
            type="checkbox"
            checked={enabled}
            disabled={saving}
            onChange={() => onToggle(id, !enabled)}
            style={{ opacity: 0, width: 0, height: 0 }}
          />
          <span
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: enabled ? "var(--accent, #4f8cff)" : "var(--border, #ddd)",
              borderRadius: "12px",
              transition: "background-color 0.2s",
            }}
          >
            <span
              style={{
                position: "absolute",
                top: "2px",
                left: enabled ? "22px" : "2px",
                width: "20px",
                height: "20px",
                backgroundColor: "#fff",
                borderRadius: "50%",
                transition: "left 0.2s",
                boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              }}
            />
          </span>
        </label>
      </div>

      <div style={{ marginTop: "10px", fontSize: "11.5px" }}>
        <span
          style={{
            color: enabled ? "var(--green, #22c55e)" : "var(--text-muted, #999)",
            fontWeight: 500,
          }}
        >
          {enabled ? "Enabled" : "Disabled"}
        </span>
      </div>
    </div>
  );
}
