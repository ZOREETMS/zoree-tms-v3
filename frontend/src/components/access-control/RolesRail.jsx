// ════════════════════════════════════════════════════════════════════
// RolesRail — left list of roles with search, gradient avatars, user
// counts and system / custom / locked tags. Lets the orchestrator know
// which role is selected and forwards "Add" / "Clone selected".
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";

function initials(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "—";
}

// Stable color per role so avatars don't repaint as the list changes.
function colorClass(roleKey) {
  if (roleKey === "admin") return "c1";
  const palette = ["c2", "c3", "c4", "c5"];
  let h = 0;
  for (let i = 0; i < roleKey.length; i++) h = (h * 31 + roleKey.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

export default function RolesRail({
  roleKeys = [],
  selected,
  onSelect,
  displayName,        // (key) => string
  isSystemRole,       // (key) => bool
  isLocked,           // (key) => bool
  userCount,          // (key) => number | undefined
  canManage = false,
  onAdd,
  onClone,
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return roleKeys;
    return roleKeys.filter((k) => {
      const dn = (displayName(k) || k).toLowerCase();
      return dn.includes(needle) || k.toLowerCase().includes(needle);
    });
  }, [roleKeys, q, displayName]);

  return (
    <section className="acc-panel acc-roles-panel">
      <div className="acc-roles-head">
        <h3>Roles</h3>
        {canManage && (
          <button
            type="button"
            className="acc-btn ghost"
            style={{ height: 30, padding: "0 8px" }}
            onClick={onAdd}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New
          </button>
        )}
      </div>

      <div className="acc-roles-search">
        <input
          type="search"
          placeholder="Search roles…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="acc-roles-list" role="listbox" aria-label="Roles">
        {filtered.length === 0 && (
          <div style={{ padding: "12px 14px", color: "var(--acc-muted)", fontSize: 13 }}>
            No roles match “{q}”.
          </div>
        )}
        {filtered.map((k) => {
          const dn      = displayName(k) || k;
          const sys     = isSystemRole(k);
          const locked  = isLocked(k);
          const count   = userCount?.(k);
          const tagText = locked ? "LOCKED" : (sys ? "SYSTEM" : "CUSTOM");
          const tagCls  = locked ? "locked" : (sys ? "" : "custom");
          return (
            <button
              key={k}
              type="button"
              role="option"
              aria-selected={selected === k}
              className={`acc-role-item${selected === k ? " active" : ""}`}
              onClick={() => onSelect?.(k)}
            >
              <span className={`acc-role-avatar ${colorClass(k)}`}>{initials(dn)}</span>
              <span className="acc-role-meta">
                <b>{dn}</b>
                <span>{count != null ? `${count} user${count === 1 ? "" : "s"}` : "—"}</span>
              </span>
              <span className={`acc-tag-mini ${tagCls}`}>{tagText}</span>
            </button>
          );
        })}
      </div>

      {canManage && (
        <div className="acc-roles-foot">
          <button
            type="button"
            className="acc-btn"
            onClick={onClone}
            disabled={!selected}
            title={selected ? "" : "Pick a role to clone"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <rect x="4" y="4" width="11" height="11" rx="2" />
            </svg>
            Clone selected role
          </button>
        </div>
      )}
    </section>
  );
}
