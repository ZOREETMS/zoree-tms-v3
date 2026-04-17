// ═══════════════════════════════════════════════════════════════════
// RoleSwitcher — REQ-08.
//
// Renders in the sidebar footer only when the signed-in user has 2+
// assigned roles. Clicking a pill calls AuthContext.switchRole, which
// PATCHes /api/auth/active-role and updates local state. The sidebar
// nav re-renders instantly because Layout reads `user.activeRole`.
//
// Role labels are short; the pill row wraps to two rows when needed.
// ═══════════════════════════════════════════════════════════════════

import { useState } from "react";
import { useAuth } from "../state/AuthContext";

const ROLE_META = {
  admin:   { label: "Admin",   icon: "🛡",  color: "#7c3aed", bg: "rgba(124,58,237,.15)" },
  planner: { label: "Planner", icon: "🧭",  color: "#0d9488", bg: "rgba(13,148,136,.15)" },
  finance: { label: "Finance", icon: "💰",  color: "#d97706", bg: "rgba(217,119,6,.15)" },
  viewer:  { label: "Viewer",  icon: "👁",  color: "#64748b", bg: "rgba(100,116,139,.15)" },
};

export default function RoleSwitcher() {
  const { user, switchRole } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const roles = Array.isArray(user?.roles) ? user.roles : [];
  const activeRole = user?.activeRole || user?.role;
  if (roles.length < 2) return null;

  const onClick = async (r) => {
    if (busy || r === activeRole) return;
    setBusy(true); setError("");
    try {
      await switchRole(r);
    } catch (e) {
      setError(e?.message || "Failed to switch role");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: "10px 12px", borderTop: "1px solid rgba(255,255,255,.08)", borderBottom: "1px solid rgba(255,255,255,.08)", marginBottom: 8 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "rgba(255,255,255,.5)", marginBottom: 6 }}>
        Active role
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {roles.map((r) => {
          const meta = ROLE_META[r] || { label: r, icon: "•", color: "#64748b", bg: "rgba(100,116,139,.15)" };
          const isActive = r === activeRole;
          return (
            <button
              key={r}
              type="button"
              onClick={() => onClick(r)}
              disabled={busy}
              title={isActive ? `Currently viewing as ${meta.label}` : `Switch to ${meta.label}`}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "4px 9px", borderRadius: 999,
                border: isActive ? `1.5px solid ${meta.color}` : "1px solid rgba(255,255,255,.15)",
                background: isActive ? meta.bg : "transparent",
                color: isActive ? "#fff" : "rgba(255,255,255,.8)",
                fontSize: 11, fontWeight: isActive ? 700 : 500,
                fontFamily: "inherit",
                cursor: busy ? "wait" : (isActive ? "default" : "pointer"),
                transition: "all .15s ease",
              }}
            >
              <span style={{ fontSize: 11 }}>{meta.icon}</span>
              <span>{meta.label}</span>
              {isActive && <span style={{ fontSize: 10, opacity: 0.7 }}>✓</span>}
            </button>
          );
        })}
      </div>
      {error && (
        <div style={{ marginTop: 6, fontSize: 10, color: "#fca5a5" }}>{error}</div>
      )}
    </div>
  );
}
