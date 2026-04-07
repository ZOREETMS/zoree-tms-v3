import { useState, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import ParameterToggleCard from "../components/planning-parameters/ParameterToggleCard";
import { fetchParameters, toggleParameter } from "../services/planningParametersService";

export default function PlanningParametersPage() {
  const data = useOutletContext();
  const [parameters, setParameters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);

  useEffect(() => {
    loadParameters();
  }, []);

  async function loadParameters() {
    setLoading(true);
    setError("");
    try {
      const rows = await fetchParameters();
      setParameters(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(e.message || "Failed to load planning parameters");
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(id, enabled) {
    setSavingId(id);
    try {
      await toggleParameter(id, enabled);
      setParameters((prev) =>
        prev.map((p) => (p.id === id ? { ...p, enabled } : p))
      );
    } catch (e) {
      setError(e.message || "Failed to update parameter");
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: "32px", textAlign: "center" }}>
        <div className="spinner" style={{ margin: "0 auto 12px" }} />
        <div className="text-muted">Loading planning parameters...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: "24px", maxWidth: "720px" }}>
      <div style={{ marginBottom: "24px" }}>
        <h2 style={{ margin: 0, fontSize: "20px" }}>Planning Parameters</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: "13px" }}>
          Enable or disable planning features. Changes take effect immediately for all future planning operations.
        </p>
      </div>

      {error && (
        <div className="card" style={{ padding: "12px", marginBottom: "16px", borderLeft: "3px solid var(--red, #ef4444)" }}>
          <span style={{ color: "var(--red, #ef4444)", fontSize: "13px" }}>{error}</span>
        </div>
      )}

      {parameters.length === 0 ? (
        <div className="card" style={{ padding: "32px", textAlign: "center" }}>
          <div style={{ fontSize: "32px", marginBottom: "8px" }}>🎛️</div>
          <div className="text-muted">No planning parameters configured yet.</div>
        </div>
      ) : (
        parameters.map((param) => (
          <ParameterToggleCard
            key={param.id}
            parameter={param}
            onToggle={handleToggle}
            saving={savingId === param.id}
          />
        ))
      )}
    </div>
  );
}
