// ════════════════════════════════════════════════════════════════════
// PoliciesPage — QA bug #261c.
//
// The User Module top tabs (UserRolesPage.jsx) advertise a "Policies"
// surface alongside Roles, Users, and API Access. The codebase has no
// app-level "Policies" concept of its own — the word historically only
// appears in Postgres RLS migration files, which are not user-facing.
// Rather than invent a new schema for a feature that hasn't been
// product-defined, this page consolidates the data that ALREADY IS the
// live policy of the system: the role_feature_permissions matrix.
//
// What this page renders:
//   • A flat, searchable, role-filterable table of every (role, module,
//     access-level) triple currently in effect for the active tenant.
//   • A CSV export so compliance/security teams can lift the snapshot
//     into audits without DB access.
//   • A small summary strip — total rules, total roles, edit/view/none
//     breakdown — so admins get a one-glance read on policy posture.
//
// Read-only by design: edits happen on the Roles page (the upstream
// matrix editor). If product later wants something richer here —
// approval workflows, named policy bundles, data-scope rules — the
// page already owns the route and the tab; we layer on top.
//
// Source of truth: /api/roles (loadRolePermissions in
// api/services/rolePermissions.js). No new tables, no new endpoints.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import "../components/access-control/access-control.css";
import { fetchRolePermissions } from "../services/roleService";

const LEVEL_META = {
  edit: { label: "Edit",    color: "#059669", bg: "rgba(5,150,105,0.10)"  },
  view: { label: "View",    color: "#2563EB", bg: "rgba(37,99,235,0.08)"  },
  none: { label: "No View", color: "#64748B", bg: "rgba(100,116,139,0.10)" },
};

function LevelChip({ level }) {
  const meta = LEVEL_META[level] || LEVEL_META.none;
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 10px",
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 600,
      color: meta.color,
      background: meta.bg,
      border: `1px solid ${meta.color}30`,
    }}>{meta.label}</span>
  );
}

function downloadCsv(filename, rows) {
  // RFC 4180-flavoured CSV: comma separator, CRLF line terminator,
  // double-quote-wrapped fields with embedded quote doubling. Kept tiny
  // and dependency-free so the export survives a stripped build.
  const escape = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(escape).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

export default function PoliciesPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [levelFilter, setLevelFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetchRolePermissions();
        if (cancelled) return;
        setData(resp);
      } catch (e) {
        if (cancelled) return;
        setErr(e?.message || "Failed to load policy snapshot");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const features    = data?.features     || [];
  const roles       = data?.roles        || {};
  const roleMeta    = data?.roleMetadata || [];

  const roleKeys = useMemo(() => Object.keys(roles).sort(), [roles]);

  const metaByKey = useMemo(() => {
    const m = {};
    for (const r of roleMeta) m[r.role_key] = r;
    return m;
  }, [roleMeta]);

  function displayRole(key) {
    return metaByKey[key]?.display_name
      || (key.charAt(0).toUpperCase() + key.slice(1));
  }

  // Flatten the (role × feature → level) matrix into rows. We compute
  // the full flat list once and let the search/filter UI narrow it
  // client-side — the dataset is bounded by roles × ~30 features (so
  // ~150-200 rows for a typical tenant), no need for server-side
  // pagination.
  const allRows = useMemo(() => {
    const out = [];
    for (const rk of roleKeys) {
      const perms = roles[rk] || {};
      for (const f of features) {
        const level = perms[f.feature_key] || "none";
        out.push({
          roleKey:     rk,
          roleLabel:   displayRole(rk),
          section:     f.section || "",
          featureKey:  f.feature_key,
          featureLabel: f.label || f.feature_key,
          level,
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, roles, roleKeys, roleMeta]);

  const filtered = useMemo(() => {
    let list = allRows;
    if (roleFilter !== "all")  list = list.filter((r) => r.roleKey === roleFilter);
    if (levelFilter !== "all") list = list.filter((r) => r.level === levelFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) =>
        r.roleLabel.toLowerCase().includes(q)    ||
        r.featureLabel.toLowerCase().includes(q) ||
        r.featureKey.toLowerCase().includes(q)   ||
        r.section.toLowerCase().includes(q),
      );
    }
    return list;
  }, [allRows, roleFilter, levelFilter, search]);

  const summary = useMemo(() => {
    const counts = { edit: 0, view: 0, none: 0 };
    for (const r of allRows) counts[r.level] = (counts[r.level] || 0) + 1;
    return {
      totalRules: allRows.length,
      totalRoles: roleKeys.length,
      totalModules: features.length,
      ...counts,
    };
  }, [allRows, roleKeys, features]);

  function handleExport() {
    const header = ["Role", "Role Key", "Section", "Module", "Module Key", "Access Level"];
    const rows = [
      header,
      ...filtered.map((r) => [
        r.roleLabel, r.roleKey, r.section, r.featureLabel, r.featureKey, LEVEL_META[r.level]?.label || r.level,
      ]),
    ];
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    downloadCsv(`policies-snapshot-${stamp}.csv`, rows);
  }

  return (
    <div style={{ padding: "24px 28px 64px" }}>
      {/* Page header — mirrors UserRolesPage so the two surfaces feel
          like siblings rather than disconnected pages. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
            Policies
          </h1>
          <p style={{ fontSize: 13, color: "var(--text2, #475569)", margin: "6px 0 0", maxWidth: 760 }}>
            Read-only snapshot of every access rule currently in effect, derived from the live
            <strong> role × module permissions matrix</strong>. To change a rule, edit the role on the{" "}
            <Link to="/user-roles" style={{ color: "var(--accent, #2563EB)", fontWeight: 600 }}>Roles</Link> page.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleExport}
          disabled={loading || filtered.length === 0}
          title="Download the currently filtered view as CSV"
        >
          Export CSV
        </button>
      </div>

      {/* Top tabs — same nav strip as UserRolesPage so admins move
          between the related surfaces without leaving the section. */}
      <div className="acc-tabs">
        <Link to="/user-management" className="acc-tab" style={{ textDecoration: "none" }}>Users</Link>
        <Link to="/user-roles"      className="acc-tab" style={{ textDecoration: "none" }}>Roles</Link>
        <button type="button" className="acc-tab active">
          Policies <span className="count">{summary.totalRules}</span>
        </button>
        <Link to="/api-access"      className="acc-tab" style={{ textDecoration: "none" }}>API Access</Link>
      </div>

      {/* Summary strip. */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: 12,
        margin: "18px 0 20px",
      }}>
        <div className="stat-card blue">
          <div className="stat-label">Total Rules</div>
          <div className="stat-value" style={{ fontSize: 24 }}>{summary.totalRules}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Roles</div>
          <div className="stat-value" style={{ fontSize: 24 }}>{summary.totalRoles}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Modules</div>
          <div className="stat-value" style={{ fontSize: 24 }}>{summary.totalModules}</div>
        </div>
        <div className="stat-card green">
          <div className="stat-label">Edit grants</div>
          <div className="stat-value" style={{ fontSize: 24 }}>{summary.edit}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">No-View denies</div>
          <div className="stat-value" style={{ fontSize: 24 }}>{summary.none}</div>
        </div>
      </div>

      {/* Filters. */}
      <div style={{
        display: "flex",
        gap: 10,
        flexWrap: "wrap",
        alignItems: "center",
        marginBottom: 12,
      }}>
        <input
          type="search"
          placeholder="Search role, module, section, or key…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: "1 1 280px", maxWidth: 420 }}
        />
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} style={{ minWidth: 180 }}>
          <option value="all">All roles</option>
          {roleKeys.map((rk) => (
            <option key={rk} value={rk}>{displayRole(rk)}</option>
          ))}
        </select>
        <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)} style={{ minWidth: 160 }}>
          <option value="all">All access levels</option>
          <option value="edit">Edit only</option>
          <option value="view">View only</option>
          <option value="none">No View only</option>
        </select>
        <span style={{ fontSize: 12, color: "var(--text2, #64748B)", marginLeft: "auto" }}>
          {filtered.length} of {allRows.length} rules shown
        </span>
      </div>

      {/* Body. */}
      {err && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <div className="alert-icon">⛔</div>
          <div className="alert-text">{err}</div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 32, textAlign: "center", color: "var(--text2, #64748B)" }}>
          Loading policy snapshot…
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="grid" style={{ border: "none", boxShadow: "none" }}>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Section</th>
                  <th>Module</th>
                  <th style={{ width: 120 }}>Access</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: 24, textAlign: "center", color: "var(--text3, #94A3B8)" }}>
                      No rules match the current filter.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr key={`${r.roleKey}::${r.featureKey}`}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.roleLabel}</div>
                        <div style={{ fontSize: 11, color: "var(--text3, #94A3B8)" }}>{r.roleKey}</div>
                      </td>
                      <td style={{ fontSize: 12, color: "var(--text2, #475569)" }}>{r.section || "—"}</td>
                      <td>
                        <div>{r.featureLabel}</div>
                        <div style={{ fontSize: 11, color: "var(--text3, #94A3B8)" }}>{r.featureKey}</div>
                      </td>
                      <td><LevelChip level={r.level} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
