import { useState } from "react";

export default function ScenarioBuilder({ lanes, params, onChange, onApply, onReset, isActive, scenarioResult }) {
  const [selectedLane, setSelectedLane] = useState(lanes[0]?.lane || "");

  function handleModel() {
    onApply(selectedLane);
  }

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">What-If Scenario Builder</span>
      </div>
      <div className="card-body" style={{ padding: 16 }}>
        <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 14 }}>
          Model rate changes and volume shifts to see cost impact
        </div>

        <div className="form-group" style={{ marginBottom: 12 }}>
          <label>Lane</label>
          <select
            value={selectedLane}
            onChange={(e) => setSelectedLane(e.target.value)}
            style={{ marginTop: 5, fontSize: 13, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", width: "100%", background: "#fff" }}
          >
            {lanes.map((l) => (
              <option key={l.lane} value={l.lane}>{l.lane}</option>
            ))}
          </select>
        </div>

        <div className="form-grid" style={{ gap: 10, marginBottom: 12 }}>
          <div className="form-group">
            <label>Rate Change (%)</label>
            <input
              type="number"
              value={params.rateChange}
              onChange={(e) => onChange({ ...params, rateChange: Number(e.target.value) || 0 })}
              style={{ marginTop: 5, fontSize: 13, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", width: "100%" }}
            />
          </div>
          <div className="form-group">
            <label>Volume Change (%)</label>
            <input
              type="number"
              value={params.volumeChange}
              onChange={(e) => onChange({ ...params, volumeChange: Number(e.target.value) || 0 })}
              style={{ marginTop: 5, fontSize: 13, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", width: "100%" }}
            />
          </div>
        </div>

        <button className="btn btn-primary" style={{ width: "100%" }} onClick={handleModel}>
          ⚡ Model Scenario
        </button>

        {scenarioResult && (
          <div
            style={{
              marginTop: 14,
              padding: 14,
              background: scenarioResult.saving >= 0 ? "var(--green-dim)" : "rgba(239,68,68,.08)",
              border: `1px solid ${scenarioResult.saving >= 0 ? "var(--green)" : "var(--red)"}`,
              borderRadius: 10,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", marginBottom: 8 }}>
              Scenario Result
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <div style={{ fontSize: 10, color: "var(--text3)" }}>New Rate</div>
                <div className="mono" style={{ fontWeight: 700 }}>${scenarioResult.newRate}/mi</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "var(--text3)" }}>New Vol</div>
                <div className="mono" style={{ fontWeight: 700 }}>{scenarioResult.newLoads} loads/mo</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "var(--text3)" }}>Monthly Impact</div>
                <div className="mono" style={{ fontWeight: 700, fontSize: 16, color: scenarioResult.saving >= 0 ? "var(--green)" : "var(--red)" }}>
                  {scenarioResult.savingStr}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "var(--text3)" }}>Annual Impact</div>
                <div className="mono" style={{ fontWeight: 700, fontSize: 16, color: scenarioResult.saving >= 0 ? "var(--green)" : "var(--red)" }}>
                  {scenarioResult.annualStr}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
