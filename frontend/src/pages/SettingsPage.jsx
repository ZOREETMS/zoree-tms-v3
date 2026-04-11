import { useEffect, useState } from "react";
import { useAuth } from "../state/AuthContext";

export default function SettingsPage() {
  const { user } = useAuth();
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");

  const apiBase =
    import.meta.env.VITE_API_BASE || window.ZOREE_API_URL || "http://localhost:3001/api";
  const apiOrigin = apiBase.replace(/\/api\/?$/, "");

  useEffect(() => {
    let active = true;
    fetch(`${apiOrigin}/health`)
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        setHealth(data);
      })
      .catch((e) => {
        if (!active) return;
        setError(e.message || "Failed to load health.");
      });
    return () => {
      active = false;
    };
  }, [apiOrigin]);

  const apiStatus = health ? "Connected" : error ? "Unavailable" : "Loading...";
  const apiColor = health ? "green" : error ? "red" : "yellow";
  const smtpHost = health?.tenderEmail?.smtpHost || "—";
  const emailOk = health?.tenderEmail?.verifyOk;
  const emailStatus = emailOk === true ? "OK" : emailOk === false ? "Failed" : "Not checked";
  const emailColor = emailOk === true ? "green" : emailOk === false ? "red" : "yellow";

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-sub">System configuration, API health, and account info</div>
        </div>
      </div>

      <div className="page-content">
        {/* Status KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
          <div className={`stat-card ${apiColor}`}>
            <div className="stat-label">API Status</div>
            <div className="stat-value" style={{ fontSize: 22 }}>{apiStatus}</div>
          </div>
          <div className={`stat-card ${emailColor}`}>
            <div className="stat-label">Email Service</div>
            <div className="stat-value" style={{ fontSize: 22 }}>{emailStatus}</div>
          </div>
          <div className="stat-card blue">
            <div className="stat-label">Environment</div>
            <div className="stat-value" style={{ fontSize: 22 }}>Development</div>
          </div>
          <div className="stat-card blue">
            <div className="stat-label">Version</div>
            <div className="stat-value" style={{ fontSize: 22 }}>v3.11</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Account Info */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Account Information</span>
            </div>
            <div className="card-body">
              <InfoRow label="User Email" value={user?.email || "—"} />
              <InfoRow label="Role" value="Admin" />
              <InfoRow label="Organization" value="Zoree" />
            </div>
          </div>

          {/* API Configuration */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">API Configuration</span>
            </div>
            <div className="card-body">
              <InfoRow label="API Base URL" value={apiBase} mono />
              <InfoRow label="API Health" value={apiStatus} color={apiColor === "green" ? "var(--green)" : apiColor === "red" ? "var(--red)" : "var(--yellow)"} />
              <InfoRow label="Database" value={health?.supabase || "Supabase"} />
              {error && (
                <div style={{ marginTop: 10, padding: "8px 12px", background: "var(--red-dim)", border: "1px solid rgba(239,68,68,.25)", borderRadius: 8, fontSize: 12, color: "var(--red)" }}>
                  {error}
                </div>
              )}
            </div>
          </div>

          {/* Email Configuration */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Email Configuration</span>
            </div>
            <div className="card-body">
              <InfoRow label="SMTP Host" value={smtpHost} mono />
              <InfoRow label="SMTP Port" value={health?.tenderEmail?.smtpPort || "587"} mono />
              <InfoRow label="Email Verify" value={emailStatus} color={emailColor === "green" ? "var(--green)" : emailColor === "red" ? "var(--red)" : "var(--yellow)"} />
              {emailOk === false && health?.tenderEmail?.verifyError && (
                <div style={{ marginTop: 10, padding: "8px 12px", background: "var(--red-dim)", border: "1px solid rgba(239,68,68,.25)", borderRadius: 8, fontSize: 12, color: "var(--red)" }}>
                  {health.tenderEmail.verifyError}
                </div>
              )}
            </div>
          </div>

          {/* Integrations */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Integrations</span>
            </div>
            <div className="card-body">
              <InfoRow label="PC*Miler" value={health?.pcmiler ? "Connected" : "Not configured"} color={health?.pcmiler ? "var(--green)" : "var(--text3)"} />
              <InfoRow label="SMC³ / CzarLite" value={health?.smc3 ? "Connected" : "Not configured"} color={health?.smc3 ? "var(--green)" : "var(--text3)"} />
              <InfoRow label="Zoree AI" value="Anthropic Claude" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".5px" }}>
        {label}
      </span>
      <span
        className={mono ? "mono" : ""}
        style={{ fontSize: 13, fontWeight: 600, color: color || "var(--text)" }}
      >
        {value}
      </span>
    </div>
  );
}
