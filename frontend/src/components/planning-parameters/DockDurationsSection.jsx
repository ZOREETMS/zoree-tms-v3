/**
 * DockDurationsSection — editor for the dock_loading_durations table.
 *
 * Rendered under the existing feature-toggle section on the Planning
 * Parameters page. Admin edits here flow through
 * dockLoadingDurationsService → /api/db/dock_loading_durations (PATCH),
 * and the in-memory cache is refreshed so new shipments pick the value
 * up immediately.
 *
 * Per-appointment overrides in the dock scheduling page still take
 * precedence — this table only defines the *default* per mode.
 */

import { useEffect, useState } from "react";
import {
  fetchDurations,
  updateDuration,
} from "../../services/dockLoadingDurationsService";

const DURATION_OPTIONS = [30, 60, 90, 120, 150, 180, 240, 300];

export default function DockDurationsSection() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [savingMode, setSavingMode] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const list = await fetchDurations();
      setRows(list);
    } catch (e) {
      setError(e.message || "Failed to load dock loading durations");
    } finally {
      setLoading(false);
    }
  }

  async function handleDurationChange(row, nextMinutes) {
    const minutes = Number(nextMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 600) {
      setError("Duration must be between 1 and 600 minutes.");
      return;
    }
    setSavingMode(row.mode);
    setError("");
    setSuccessMsg("");
    try {
      const updated = await updateDuration(row.mode, { duration_minutes: minutes });
      setRows((prev) =>
        prev.map((r) => (r.mode === row.mode ? { ...r, ...updated } : r))
      );
      setSuccessMsg(`${row.label || row.mode} default set to ${minutes} min.`);
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (e) {
      setError(e.message || "Failed to update duration");
    } finally {
      setSavingMode(null);
    }
  }

  async function handleEnabledChange(row, nextValue) {
    const enabled = nextValue === "yes";
    setSavingMode(row.mode);
    setError("");
    setSuccessMsg("");
    try {
      const updated = await updateDuration(row.mode, { enabled });
      setRows((prev) =>
        prev.map((r) => (r.mode === row.mode ? { ...r, ...updated } : r))
      );
      setSuccessMsg(`${row.label || row.mode} ${enabled ? "enabled" : "disabled"}.`);
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (e) {
      setError(e.message || "Failed to update status");
    } finally {
      setSavingMode(null);
    }
  }

  if (loading) {
    return (
      <div className="card" style={{ padding: "24px", marginTop: "24px", textAlign: "center" }}>
        <div className="spinner" style={{ margin: "0 auto 8px" }} />
        <div className="text-muted">Loading dock loading durations...</div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: "32px" }}>
      <div style={{ marginBottom: "16px" }}>
        <h3 style={{ margin: 0, fontSize: "16px" }}>Dock Loading Durations</h3>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: "12.5px" }}>
          Default loading window per shipment mode. Applies to newly auto-assigned
          dock appointments. Per-appointment edits on the Dock Scheduling page
          still override these defaults.
        </p>
      </div>

      {error && (
        <div className="card" style={{ padding: "12px", marginBottom: "12px", borderLeft: "3px solid var(--red, #ef4444)" }}>
          <span style={{ color: "var(--red, #ef4444)", fontSize: "13px" }}>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="card" style={{ padding: "12px", marginBottom: "12px", borderLeft: "3px solid var(--green, #22c55e)" }}>
          <span style={{ color: "var(--green, #22c55e)", fontSize: "13px" }}>{successMsg}</span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card" style={{ padding: "24px", textAlign: "center" }}>
          <div style={{ fontSize: "28px", marginBottom: "6px" }}>🚪</div>
          <div className="text-muted">No dock loading durations configured.</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ backgroundColor: "var(--bg-alt, #f8f9fa)", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                <th style={thStyle}>Mode</th>
                <th style={thStyle}>Description</th>
                <th style={{ ...thStyle, textAlign: "center", width: "160px" }}>Duration (min)</th>
                <th style={{ ...thStyle, textAlign: "center", width: "120px" }}>Enabled?</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isSaving = savingMode === row.mode;
                return (
                  <tr key={row.mode} style={{ borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{row.mode}</td>
                    <td style={{ ...tdStyle, color: "var(--text-muted, #6b7280)", fontSize: "12.5px" }}>
                      {row.label || "—"}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      <select
                        value={row.duration_minutes}
                        onChange={(e) => handleDurationChange(row, e.target.value)}
                        disabled={isSaving}
                        style={selectStyle(isSaving)}
                      >
                        {buildOptions(row.duration_minutes).map((v) => (
                          <option key={v} value={v}>{v} min</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      <select
                        value={row.enabled ? "yes" : "no"}
                        onChange={(e) => handleEnabledChange(row, e.target.value)}
                        disabled={isSaving}
                        style={{
                          ...selectStyle(isSaving),
                          backgroundColor: row.enabled ? "#ecfdf5" : "#fef2f2",
                          color: row.enabled ? "#059669" : "#dc2626",
                        }}
                      >
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function buildOptions(current) {
  const set = new Set(DURATION_OPTIONS);
  if (Number.isFinite(current)) set.add(Number(current));
  return Array.from(set).sort((a, b) => a - b);
}

const thStyle = {
  padding: "12px 16px",
  textAlign: "left",
  fontSize: "12px",
  fontWeight: 600,
  textTransform: "uppercase",
  color: "var(--text-muted, #6b7280)",
};

const tdStyle = {
  padding: "14px 16px",
  fontSize: "13.5px",
};

function selectStyle(disabled) {
  return {
    padding: "6px 12px",
    borderRadius: "6px",
    border: "1px solid var(--border, #d1d5db)",
    fontSize: "13px",
    fontWeight: 500,
    cursor: disabled ? "not-allowed" : "pointer",
    minWidth: "96px",
  };
}
