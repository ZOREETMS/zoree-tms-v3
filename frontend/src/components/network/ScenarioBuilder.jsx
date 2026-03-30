export default function ScenarioBuilder({ params, onChange, onApply, onReset, isActive }) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">What-If Scenario Builder</span>
      </div>
      <div className="card-body" style={{ padding: 16 }}>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".8px", display: "block", marginBottom: 6 }}>
            Rate Change (%)
          </label>
          <input
            type="range"
            min={-30}
            max={30}
            value={params.rateChange}
            onChange={(e) => onChange({ ...params, rateChange: Number(e.target.value) })}
            style={{ width: "100%" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text3)" }}>
            <span>-30%</span>
            <span style={{ fontWeight: 700, color: "var(--text1)" }}>{params.rateChange > 0 ? "+" : ""}{params.rateChange}%</span>
            <span>+30%</span>
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".8px", display: "block", marginBottom: 6 }}>
            Volume Change (%)
          </label>
          <input
            type="range"
            min={-50}
            max={50}
            value={params.volumeChange}
            onChange={(e) => onChange({ ...params, volumeChange: Number(e.target.value) })}
            style={{ width: "100%" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text3)" }}>
            <span>-50%</span>
            <span style={{ fontWeight: 700, color: "var(--text1)" }}>{params.volumeChange > 0 ? "+" : ""}{params.volumeChange}%</span>
            <span>+50%</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={onApply} style={{ flex: 1 }}>
            ⚡ Apply Scenario
          </button>
          {isActive && (
            <button className="btn btn-secondary btn-sm" onClick={onReset}>
              ↺ Reset
            </button>
          )}
        </div>

        {isActive && (
          <div style={{
            marginTop: 12, padding: "8px 12px", background: "#fffbeb",
            border: "1px solid #fde68a", borderRadius: 8, fontSize: 12, color: "#92400e",
          }}>
            Scenario active — table shows projected values
          </div>
        )}
      </div>
    </div>
  );
}
