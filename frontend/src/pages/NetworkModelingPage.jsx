import { useState } from "react";
import { useNetwork } from "../hooks/useNetwork";
import NetworkStats from "../components/network/NetworkStats";
import LaneTable from "../components/network/LaneTable";
import ScenarioBuilder from "../components/network/ScenarioBuilder";

export default function NetworkModelingPage() {
  const {
    lanes, kpis, scenarioParams, setScenarioParams,
    applyScenario, resetScenario, isScenarioActive, scenarioResult,
  } = useNetwork();

  const [toast, setToast] = useState(null);

  function showToast(message, type) {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  function handleSaveScenario() {
    showToast("Scenario saved", "success");
  }

  function handleRunAnalysis() {
    applyScenario();
    showToast("Analysis complete — scenario applied to lane matrix", "success");
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Network Modeling</div>
          <div className="page-sub">Lane analysis, cost benchmarking, and what-if scenarios</div>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary btn-sm" onClick={handleSaveScenario}>
            💾 Save Scenario
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleRunAnalysis}>
            ⚡ Run Analysis
          </button>
        </div>
      </div>

      <div className="page-content">
        <NetworkStats kpis={kpis} />

        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
          <LaneTable lanes={lanes} />
          <ScenarioBuilder
            lanes={lanes}
            params={scenarioParams}
            onChange={setScenarioParams}
            onApply={applyScenario}
            onReset={resetScenario}
            isActive={isScenarioActive}
            scenarioResult={scenarioResult}
          />
        </div>
      </div>

      {toast && (
        <div className="toast-wrap">
          <div className="toast">
            <span style={{ fontSize: 16 }}>{toast.type === "success" ? "✅" : "ℹ️"}</span>
            <span style={{ fontSize: 13 }}>{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}
