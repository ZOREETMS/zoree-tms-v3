// ════════════════════════════════════════════════════════════════════
// UserRolesPage — pivoted role × module access matrix.
//
// Layout:
//   Rows    : modules, grouped by sidebar section (collapsible).
//   Columns : roles (Admin locked, then planner/finance/viewer/custom).
//   Cells   : RoleAccessSelect dropdown (Edit / View / No View).
//
// UX:
//   - Search box filters modules by label.
//   - Sticky header row + sticky module column keep context while
//     scrolling through ~30 modules.
//   - Per-row "Set all →" lets an admin push one level to every role
//     for that module in one shot.
//   - QA #140: changes are STAGED locally and persisted only when the
//     admin clicks Save Changes. Discard reverts all pending edits.
//     The previous auto-save-per-cell flow (a) gave admins no way to
//     undo and (b) issued one mutation per cell which made bulk edits
//     feel slow (QA #137 — same fix lands both tickets).
//   - Admin can add/delete custom roles; system roles are protected.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import { useAuth } from "../state/AuthContext";
import {
  useRolePermissions,
  useUpdateRolePermissions,
  useCreateRole,
  useDeleteRole,
} from "../hooks/useRolePermissions";
import RoleAccessSelect from "../components/user-roles/RoleAccessSelect";
import AddRoleModal from "../components/user-roles/AddRoleModal";

const ADMIN_ROLE_KEY = "admin";
const SECTION_ORDER = [
  "Overview", "Planning", "Execution", "Finance",
  "Documents", "Integration", "Insights", "System",
];
const SYSTEM_ROLE_ORDER = ["admin", "planner", "finance", "viewer"];

export default function UserRolesPage() {
  const { user } = useAuth();
  const isAdmin = (user?.activeRole || user?.role || "").toLowerCase() === "admin";

  const roleQuery = useRolePermissions();
  const updateMutation = useUpdateRolePermissions();
  const createMutation = useCreateRole();
  const deleteMutation = useDeleteRole();

  const features    = roleQuery.data?.features     || [];
  const featureKeys = roleQuery.data?.featureKeys  || features.map((f) => f.feature_key);
  const roles       = roleQuery.data?.roles        || {};
  const roleMeta    = roleQuery.data?.roleMetadata || [];

  // ── Local UI state ──────────────────────────────────────────────────
  const [saveError,    setSaveError]    = useState("");
  const [showAdd,      setShowAdd]      = useState(false);
  const [createError,  setCreateError]  = useState("");
  const [deletingRole, setDeletingRole] = useState("");
  const [search,       setSearch]       = useState("");
  const [collapsed,    setCollapsed]    = useState(() => new Set());

  // QA #140 / #137: stage all matrix edits in `pending` until the admin
  // clicks Save. Shape: { [roleKey]: { [featureKey]: 'edit'|'view'|'none' } }
  // Only roles/features that actually changed appear in this map, so we
  // can issue a minimum number of mutateAsync calls (one per touched
  // role) on save instead of one per cell.
  const [pending, setPending] = useState({});
  const [saving,  setSaving]  = useState(false);
  const pendingCount = useMemo(() => {
    let n = 0;
    for (const roleKey of Object.keys(pending)) {
      n += Object.keys(pending[roleKey] || {}).length;
    }
    return n;
  }, [pending]);
  const dirty = pendingCount > 0;

  /** Resolve the displayed level for a cell: pending wins over saved. */
  function effectiveLevel(roleKey, featureKey) {
    const p = pending[roleKey];
    if (p && Object.prototype.hasOwnProperty.call(p, featureKey)) return p[featureKey];
    return roles?.[roleKey]?.[featureKey] || "none";
  }

  // ── Derived: ordered role columns ───────────────────────────────────
  const sortedRoleKeys = useMemo(() => {
    const all = Object.keys(roles);
    const sys = SYSTEM_ROLE_ORDER.filter((k) => all.includes(k));
    const custom = all.filter((k) => !SYSTEM_ROLE_ORDER.includes(k)).sort();
    return [...sys, ...custom];
  }, [roles]);

  const metaByKey = useMemo(() => {
    const m = {};
    roleMeta.forEach((r) => { m[r.role_key] = r; });
    return m;
  }, [roleMeta]);

  const isSystemRole = (key) =>
    !!metaByKey[key]?.is_system || SYSTEM_ROLE_ORDER.includes(key);

  const displayRole = (key) =>
    metaByKey[key]?.display_name
    || (key === "finance" ? "Finance user"
        : key.charAt(0).toUpperCase() + key.slice(1));

  // ── Derived: features grouped by section, search-filtered ──────────
  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    const bySection = new Map();
    for (const f of features) {
      const matches = !q
        || (f.label || "").toLowerCase().includes(q)
        || (f.feature_key || "").toLowerCase().includes(q);
      if (!matches) continue;
      const section = f.module || "Other";
      if (!bySection.has(section)) bySection.set(section, []);
      bySection.get(section).push(f);
    }
    // Sort within section by sort_order, then label.
    for (const list of bySection.values()) {
      list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
        || String(a.label || "").localeCompare(String(b.label || "")));
    }
    // Section iteration order: known order first, then any unknowns alphabetically.
    const known = SECTION_ORDER.filter((s) => bySection.has(s));
    const extras = [...bySection.keys()]
      .filter((s) => !SECTION_ORDER.includes(s))
      .sort();
    return [...known, ...extras].map((name) => ({ name, items: bySection.get(name) }));
  }, [features, search]);

  // ── Handlers ────────────────────────────────────────────────────────
  // QA #140: stage one cell's change in local state. Only persists on Save.
  function handleLevelChange(roleKey, featureKey, nextLevel) {
    if (!isAdmin) return;
    if (roleKey === ADMIN_ROLE_KEY) return;
    setSaveError("");
    setPending((prev) => {
      const next = { ...prev };
      const savedLevel = roles?.[roleKey]?.[featureKey] || "none";
      const roleMap = { ...(next[roleKey] || {}) };
      if (nextLevel === savedLevel) {
        // Reverting to saved value — drop the pending entry so dirty
        // counts stay accurate.
        delete roleMap[featureKey];
      } else {
        roleMap[featureKey] = nextLevel;
      }
      if (Object.keys(roleMap).length === 0) {
        delete next[roleKey];
      } else {
        next[roleKey] = roleMap;
      }
      return next;
    });
  }

  // QA #140: "Set all" stages the same level for every non-admin role.
  function handleSetRow(featureKey, level) {
    if (!isAdmin) return;
    setSaveError("");
    setPending((prev) => {
      const next = { ...prev };
      const targets = sortedRoleKeys.filter((r) => r !== ADMIN_ROLE_KEY);
      for (const roleKey of targets) {
        const savedLevel = roles?.[roleKey]?.[featureKey] || "none";
        const roleMap = { ...(next[roleKey] || {}) };
        if (level === savedLevel) {
          delete roleMap[featureKey];
        } else {
          roleMap[featureKey] = level;
        }
        if (Object.keys(roleMap).length === 0) delete next[roleKey];
        else next[roleKey] = roleMap;
      }
      return next;
    });
  }

  // QA #140 + #137: persist all staged edits in one click. We issue one
  // mutateAsync per ROLE (not per cell) — saveRolePermissions on the
  // backend already accepts the full per-role access map, so an admin
  // touching N cells across a role still only makes one round-trip.
  async function handleSavePending() {
    if (!isAdmin || !dirty || saving) return;
    setSaveError("");
    setSaving(true);
    try {
      const touchedRoles = Object.keys(pending);
      for (const roleKey of touchedRoles) {
        const merged = { ...(roles[roleKey] || {}), ...(pending[roleKey] || {}) };
        await updateMutation.mutateAsync({ roleName: roleKey, permissions: merged });
      }
      setPending({});
    } catch (e) {
      setSaveError(e.message || "Failed saving role permissions");
    } finally {
      setSaving(false);
    }
  }

  function handleDiscardPending() {
    setPending({});
    setSaveError("");
  }

  async function handleCreate({ roleKey, displayName: dn, description, defaultLevel }) {
    setCreateError("");
    try {
      await createMutation.mutateAsync({ roleKey, displayName: dn, description, defaultLevel });
      setShowAdd(false);
    } catch (e) {
      setCreateError(e.message || "Failed to create role");
    }
  }

  async function handleDeleteRole(roleKey) {
    if (!isAdmin) return;
    if (isSystemRole(roleKey)) return;
    const ok = window.confirm(`Delete role '${displayRole(roleKey)}'? This cannot be undone.`);
    if (!ok) return;
    setDeletingRole(roleKey);
    setSaveError("");
    try {
      await deleteMutation.mutateAsync(roleKey);
    } catch (e) {
      setSaveError(e.message || "Failed to delete role");
    } finally {
      setDeletingRole("");
    }
  }

  function toggleSection(name) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  // ── Styles ──────────────────────────────────────────────────────────
  const stickyHeader = {
    position: "sticky", top: 0, zIndex: 3,
    background: "#f7f9fc", borderBottom: "1px solid #e3e7ee",
  };
  const stickyFirstCol = {
    position: "sticky", left: 0, zIndex: 2,
    background: "#fff", borderRight: "1px solid #eef0f3",
  };
  const stickyHeaderFirstCol = {
    ...stickyFirstCol, ...stickyHeader, zIndex: 4, background: "#f7f9fc",
  };

  const loading   = roleQuery.isLoading;
  const loadError = roleQuery.error?.message || "";
  const totalModules = features.length;

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div>
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <div className="page-title">User Roles</div>
          <div className="page-sub">
            Module-level access (Edit / View / No View) per role
            {totalModules > 0 && <span style={{ marginLeft: 6, color: "#888" }}>· {totalModules} modules</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="search"
            placeholder="Search modules…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={loading}
            style={{ padding: "6px 10px", border: "1px solid #d4d8e0", borderRadius: 6, fontSize: 13, width: 220 }}
          />
          <button
            className="btn btn-primary"
            onClick={() => { setCreateError(""); setShowAdd(true); }}
            disabled={!isAdmin || loading}
            title={!isAdmin ? "Admin role required" : ""}
          >
            + Add Role
          </button>
        </div>
      </div>

      <div className="page-content">
        {!isAdmin && (
          <div className="alert alert-warning" style={{ marginBottom: 16 }}>
            <div className="alert-icon">⚠️</div>
            <div className="alert-text">
              <div className="alert-title">Read-only access</div>
              Only admins can update role permissions or add new roles.
            </div>
          </div>
        )}
        {!!loadError && (
          <div className="alert alert-danger" style={{ marginBottom: 16 }}>
            <div className="alert-icon">⛔</div>
            <div className="alert-text">
              <div className="alert-title">Could not load roles</div>{loadError}
            </div>
          </div>
        )}
        {!!saveError && (
          <div className="alert alert-danger" style={{ marginBottom: 16 }}>
            <div className="alert-icon">⛔</div>
            <div className="alert-text">
              <div className="alert-title">Save failed</div>{saveError}
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-header">
            <span className="card-title">Role Permission Matrix</span>
            {loading && <span className="text-sm text-muted">Loading…</span>}
          </div>

          <div className="card-body" style={{ padding: 0 }}>
            <div style={{ maxHeight: "calc(100vh - 260px)", overflow: "auto", borderTop: "1px solid #eef0f3" }}>
              <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", minWidth: 720 }}>
                <thead>
                  <tr>
                    <th style={{ ...stickyHeaderFirstCol, padding: "10px 12px", textAlign: "left", minWidth: 240 }}>
                      Module
                    </th>
                    {sortedRoleKeys.map((roleKey) => (
                      <th
                        key={roleKey}
                        style={{ ...stickyHeader, padding: "10px 8px", textAlign: "left", minWidth: 120 }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ fontWeight: 600 }}>{displayRole(roleKey)}</span>
                          <span style={{ fontSize: 10, color: "#999" }}>
                            {roleKey === ADMIN_ROLE_KEY
                              ? "system · locked"
                              : isSystemRole(roleKey) ? "system" : "custom"}
                            {!isSystemRole(roleKey) && isAdmin && (
                              <button
                                type="button"
                                onClick={() => handleDeleteRole(roleKey)}
                                disabled={deletingRole === roleKey}
                                style={{
                                  marginLeft: 6, fontSize: 10, color: "#c73a3a",
                                  background: "none", border: "none", cursor: "pointer",
                                  padding: 0,
                                }}
                                title={`Delete ${displayRole(roleKey)}`}
                              >
                                {deletingRole === roleKey ? "…" : "delete"}
                              </button>
                            )}
                          </span>
                        </div>
                      </th>
                    ))}
                    <th style={{ ...stickyHeader, padding: "10px 8px", textAlign: "left", minWidth: 90 }}>
                      Set row
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sections.length === 0 && !loading && (
                    <tr>
                      <td colSpan={sortedRoleKeys.length + 2} className="text-muted" style={{ padding: 16 }}>
                        {search ? `No modules match "${search}".` : "No module data found."}
                      </td>
                    </tr>
                  )}

                  {sections.map((section) => {
                    const isCollapsed = collapsed.has(section.name);
                    return (
                      <ModuleSectionRows
                        key={section.name}
                        section={section}
                        collapsed={isCollapsed}
                        onToggleSection={() => toggleSection(section.name)}
                        sortedRoleKeys={sortedRoleKeys}
                        roles={roles}
                        savingCell={savingCell}
                        deletingRole={deletingRole}
                        isAdmin={isAdmin}
                        onLevelChange={handleLevelChange}
                        onSetRow={handleSetRow}
                        stickyFirstCol={stickyFirstCol}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ padding: "10px 14px", fontSize: 12, color: "#666", borderTop: "1px solid #eef0f3" }}>
              <strong style={{ color: "#0a8754" }}>Edit</strong> — full create / update / delete.
              <strong style={{ color: "#b86e00", marginLeft: 10 }}>View</strong> — read-only.
              <strong style={{ color: "#888", marginLeft: 10 }}>No View</strong> — module is hidden.
              The Admin column is locked.
            </div>
          </div>
        </div>
      </div>

      <AddRoleModal
        open={showAdd}
        busy={createMutation.isPending}
        errorText={createError}
        existingRoleKeys={sortedRoleKeys}
        onClose={() => setShowAdd(false)}
        onCreate={handleCreate}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// One sidebar section + its module rows. Extracted so the per-section
// collapse state stays cheap.
// ──────────────────────────────────────────────────────────────────────
function ModuleSectionRows({
  section, collapsed, onToggleSection,
  sortedRoleKeys, roles, savingCell, deletingRole,
  isAdmin, onLevelChange, onSetRow, stickyFirstCol,
}) {
  return (
    <>
      <tr style={{ background: "#f4f6fa" }}>
        <td
          colSpan={sortedRoleKeys.length + 2}
          style={{ padding: "8px 12px", borderTop: "1px solid #e3e7ee", borderBottom: "1px solid #e3e7ee", cursor: "pointer", fontSize: 11, letterSpacing: 0.4, fontWeight: 700, color: "#525c6e", textTransform: "uppercase" }}
          onClick={onToggleSection}
        >
          <span style={{ display: "inline-block", width: 14 }}>{collapsed ? "▸" : "▾"}</span>
          {section.name} <span style={{ color: "#9aa3b0", fontWeight: 500, marginLeft: 6 }}>· {section.items.length}</span>
        </td>
      </tr>
      {!collapsed && section.items.map((feature) => (
        <tr key={feature.feature_key} style={{ borderBottom: "1px solid #f2f3f5" }}>
          <td style={{ ...stickyFirstCol, padding: "8px 12px" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 13 }}>{feature.label || feature.feature_key}</span>
              <span style={{ fontSize: 10, color: "#9aa3b0" }}>{feature.feature_key}</span>
            </div>
          </td>
          {sortedRoleKeys.map((roleKey) => {
            const isAdminCol  = roleKey === ADMIN_ROLE_KEY;
            const cellId      = `${roleKey}:${feature.feature_key}`;
            const isSaving    = savingCell === cellId;
            const isDeleting  = deletingRole === roleKey;
            const disabled    = !isAdmin || isAdminCol || isSaving || isDeleting;
            const level       = roles?.[roleKey]?.[feature.feature_key] || "none";
            return (
              <td key={cellId} style={{ padding: "6px 8px" }}>
                <RoleAccessSelect
                  level={level}
                  disabled={disabled}
                  rowKey={roleKey}
                  colKey={feature.feature_key}
                  onChange={(next) => onLevelChange(roleKey, feature.feature_key, next)}
                />
              </td>
            );
          })}
          <td style={{ padding: "6px 8px" }}>
            <RowQuickActions
              disabled={!isAdmin}
              onPick={(level) => onSetRow(feature.feature_key, level)}
            />
          </td>
        </tr>
      ))}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tiny "set row to X" helper — applies the chosen level to every
// non-admin role for the row.
// ──────────────────────────────────────────────────────────────────────
function RowQuickActions({ disabled, onPick }) {
  return (
    <select
      defaultValue=""
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value;
        if (!v) return;
        onPick?.(v);
        e.target.value = "";       // reset so it can be picked again
      }}
      title="Apply this level to all non-admin roles for this module"
      style={{
        width: "100%", minWidth: 84, padding: "4px 6px",
        borderRadius: 6, border: "1px solid #d4d8e0",
        background: disabled ? "#f7f7f7" : "#fff",
        color: disabled ? "#aaa" : "#444",
        fontSize: 11, cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <option value="">Set all →</option>
      <option value="edit">All Edit</option>
      <option value="view">All View</option>
      <option value="none">All No View</option>
    </select>
  );
}
