import { useState, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import { fetchParameters, updateParameter } from "../services/planningParametersService";

export default function PlanningParametersPage() {
  const data = useOutletContext();
  const [parameters, setParameters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingKey, setSavingKey] = useState(null);
  const [successMsg, setSuccessMsg] = useState("");

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

  async function handleChange(param, newValue) {
    const enabled = newValue === "yes";
    setSavingKey(param.key);
    setError("");
    setSuccessMsg("");
    try {
      await updateParameter(param.id, enabled);
      setParameters((prev) =>
        prev.map((p) => (p.id === param.id ? { ...p, enabled } : p))
      );
      setSuccessMsg(`${param.label} ${enabled ? "enabled" : "disabled"} successfully.`);
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (e) {
      setError(e.message || "Failed to update parameter");
    } finally {
      setSavingKey(null);
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
    <div style={{ padding: "24px", maxWidth: "800px" }}>
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

      {successMsg && (
        <div className="card" style={{ padding: "12px", marginBottom: "16px", borderLeft: "3px solid var(--green, #22c55e)" }}>
          <span style={{ color: "var(--green, #22c55e)", fontSize: "13px" }}>{successMsg}</span>
        </div>
      )}

      {parameters.length === 0 ? (
        <div className="card" style={{ padding: "32px", textAlign: "center" }}>
          <div style={{ fontSize: "32px", marginBottom: "8px" }}>🎛️</div>
          <div className="text-muted">No planning parameters configured yet.</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ backgroundColor: "var(--bg-alt, #f8f9fa)", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted, #6b7280)" }}>Parameter</th>
                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted, #6b7280)" }}>Description</th>
                <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "12px", fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted, #6b7280)", width: "120px" }}>Use?</th>
              </tr>
            </thead>
            <tbody>
              {parameters.map((param) => (
                <tr key={param.id} style={{ borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                  <td style={{ padding: "14px 16px", fontWeight: 500, fontSize: "13.5px" }}>
                    {param.label}
                  </td>
                  <td style={{ padding: "14px 16px", fontSize: "12.5px", color: "var(--text-muted, #6b7280)" }}>
                    {param.description}
                  </td>
                  <td style={{ padding: "14px 16px", textAlign: "center" }}>
                    <select
                      value={param.enabled ? "yes" : "no"}
                      onChange={(e) => handleChange(param, e.target.value)}
                      disabled={savingKey === param.key}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "6px",
                        border: "1px solid var(--border, #d1d5db)",
                        fontSize: "13px",
                        fontWeight: 500,
                        cursor: savingKey === param.key ? "not-allowed" : "pointer",
                        backgroundColor: param.enabled ? "#ecfdf5" : "#fef2f2",
                        color: param.enabled ? "#059669" : "#dc2626",
                        minWidth: "80px",
                      }}
                    >
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
