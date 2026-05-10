// ════════════════════════════════════════════════════════════════════
// UserRolesPage — "Access Control Center".
//
// Layout:
//   ┌──────────────────────────────────────────────────────────────┐
//   │ Tabs: Users · Roles · Policies · API Access                  │
//   ├───────────────┬──────────────────────────────────────────────┤
//   │ RolesRail     │ RoleHeader (hero + counts + delete)          │
//   │  (left)       │ ViewSwitcher · search · bulk menu            │
//   │               │ PermissionsView | HeatmapView | MatrixView   │
//   └───────────────┴──────────────────────────────────────────────┘
//
// This file is the orchestrator: it owns query/mutation wiring, the
// staged `pending` map, and the active role + view selection. Render
// belongs to the small components in components/access-control/*.
//
// Save semantics (preserved from QA #137 / #140 — see git history):
//   • Edits stage locally in `pending` so admins can Discard / Save.
//   • On Save we issue ONE mutateAsync per touched role with the full
//     merged feature map — bulk edits stay one round-trip per role.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import "../components/access-control/access-control.css";

import { useAuth } from "../state/AuthContext";
import {
  useRolePermissions,
  useUpdateRolePermissions,
  useCreateRole,
  useDeleteRole,
} from "../hooks/useRolePermissions";

import RolesRail        from "../components/access-control/RolesRail";
import RoleHeader       from "../components/access-control/RoleHeader";
import ViewSwitcher     from "../components/access-control/ViewSwitcher";
import PermissionsView  from "../components/access-control/PermissionsView";
import HeatmapView      from "../components/access-control/HeatmapView";
import MatrixView       from "../components/access-control/MatrixView";
import SaveBar          from "../components/access-control/SaveBar";
import AddRoleModal     from "../components/user-roles/AddRoleModal";

const ADMIN_ROLE_KEY    = "admin";
const SECTION_ORDER     = ["Overview", "Planning", "Execution", "Finance", "Documents", "Integration", "Insights", "System"];
const SYSTEM_ROLE_ORDER = ["admin", "planner", "finance", "viewer"];

export default function UserRolesPage() {
  const { user } = useAuth();
  const isAdmin  = (user?.activeRole || user?.role || "").toLowerCase() === "admin";

  const roleQuery      = useRolePermissions();
  const updateMutation = useUpdateRolePermissions();
  const createMutation = useCreateRole();
  const deleteMutation = useDeleteRole();

  const features    = roleQuery.data?.features     || [];
  const roles       = roleQuery.data?.roles        || {};
  const roleMeta    = roleQuery.data?.roleMetadata || [];
  const loading     = roleQuery.isLoading;
  const loadError   = roleQuery.error?.message     || "";

  // ── Local UI state ──────────────────────────────────────────────────
  const [activeRole,   setActiveRole]   = useState("");
  const [view,         setView]         = useState("detail"); // 'detail' | 'heat' | 'matrix'
  const [search,       setSearch]       = useState("");
  const [pending,      setPending]      = useState({}); // { [roleKey]: { [featureKey]: level } }
  const [saving,       setSaving]       = useState(false);
  const [saveError,    setSaveError]    = useState("");
  const [showAdd,      setShowAdd]      = useState(false);
  const [createError,  setCreateError]  = useState("");
  const [deletingRole, setDeletingRole] = useState("");
  const [bulkOpen,     setBulkOpen]     = useState(false);
  const [descDraft,    setDescDraft]    = useState({}); // local-only, until backend supports it

  // ── Derived: ordered role columns ──────────────────────────────────
  const sortedRoleKeys = useMemo(() => {
    const all = Object.keys(roles);
    const sys = SYSTEM_ROLE_ORDER.filter((k) => all.includes(k));
    const custom = all.filter((k) => !SYSTEM_ROLE_ORDER.includes(k)).sort();
    return [...sys, ...custom];
  }, [roles]);

  // Default selection: first non-admin role (admin is locked → not the
  // most useful starting point for editing). Falls back to admin if
  // that's all there is.
  useEffect(() => {
    if (activeRole && sortedRoleKeys.includes(activeRole)) return;
    const firstEditable = sortedRoleKeys.find((k) => k !== ADMIN_ROLE_KEY);
    setActiveRole(firstEditable || sortedRoleKeys[0] || "");
  }, [sortedRoleKeys, activeRole]);

  const metaByKey = useMemo(() => {
    const m = {};
    for (const r of roleMeta) m[r.role_key] = r;
    return m;
  }, [roleMeta]);

  function isSystemRole(key) {
    return !!metaByKey[key]?.is_system || SYSTEM_ROLE_ORDER.includes(key);
  }
  function isLockedRole(key) {
    return key === ADMIN_ROLE_KEY;
  }
  function displayRole(key) {
    return metaByKey[key]?.display_name
      || (key === "finance" ? "Finance user"
          : key.charAt(0).toUpperCase() + key.slice(1));
  }
  function descriptionFor(key) {
    if (Object.prototype.hasOwnProperty.call(descDraft, key)) return descDraft[key];
    return metaByKey[key]?.description || "";
  }
  function userCountFor(key) {
    const n = metaByKey[key]?.user_count;
    return Number.isFinite(n) ? n : undefined;
  }

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
    for (const list of bySection.values()) {
      list.sort((a, b) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0)
        || String(a.label || "").localeCompare(String(b.label || ""))
      );
    }
    const known  = SECTION_ORDER.filter((s) => bySection.has(s));
    const extras = [...bySection.keys()].filter((s) => !SECTION_ORDER.includes(s)).sort();
    return [...known, ...extras].map((name) => ({ name, items: bySection.get(name) }));
  }, [features, search]);

  // ── Pending diff helpers ───────────────────────────────────────────
  const pendingCount = useMemo(() => {
    let n = 0;
    for (const k of Object.keys(pending)) n += Object.keys(pending[k] || {}).length;
    return n;
  }, [pending]);
  const dirty = pendingCount > 0;

  function effectiveLevel(roleKey, featureKey) {
    const p = pending[roleKey];
    if (p && Object.prototype.hasOwnProperty.call(p, featureKey)) return p[featureKey];
    return roles?.[roleKey]?.[featureKey] || "none";
  }
  function isPendingCell(roleKey, featureKey) {
    const p = pending[roleKey];
    return !!(p && Object.prototype.hasOwnProperty.call(p, featureKey));
  }

  // Pre-compute counts for the active role (header pills).
  const counts = useMemo(() => {
    const c = { edit: 0, view: 0, none: 0 };
    if (!activeRole) return c;
    for (const f of features) {
      const v = effectiveLevel(activeRole, f.feature_key);
      if (v === "edit") c.edit++;
      else if (v === "view") c.view++;
      else c.none++;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, activeRole, pending, roles]);

  // ── Mutations ──────────────────────────────────────────────────────
  function handleLevelChange(roleKey, featureKey, nextLevel) {
    if (!isAdmin) return;
    if (isLockedRole(roleKey)) return;
    setSaveError("");
    setPending((prev) => {
      const next = { ...prev };
      const savedLevel = roles?.[roleKey]?.[featureKey] || "none";
      const roleMap = { ...(next[roleKey] || {}) };
      if (nextLevel === savedLevel) {
        delete roleMap[featureKey];
      } else {
        roleMap[featureKey] = nextLevel;
      }
      if (Object.keys(roleMap).length === 0) delete next[roleKey];
      else next[roleKey] = roleMap;
      return next;
    });
  }

  // Apply one level to every visible feature for one role (Detail / Heat / Matrix bulk).
  function bulkSetLevelForRole(roleKey, level) {
    if (!isAdmin || isLockedRole(roleKey)) return;
    for (const sec of sections) {
      for (const f of sec.items) {
        handleLevelChange(roleKey, f.feature_key, level);
      }
    }
  }
  function bulkSetLevelAllRoles(level) {
    for (const k of sortedRoleKeys) {
      if (isLockedRole(k)) continue;
      bulkSetLevelForRole(k, level);
    }
  }

  async function handleSavePending() {
    if (!isAdmin || !dirty || saving) return;
    setSaveError("");
    setSaving(true);
    try {
      // QA #140 + #137: one round-trip per touched role, not per cell.
      for (const roleKey of Object.keys(pending)) {
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
      setActiveRole(roleKey);   // jump to it
    } catch (e) {
      setCreateError(e.message || "Failed to create role");
    }
  }

  async function handleDeleteRole(roleKey) {
    if (!isAdmin || isSystemRole(roleKey)) return;
    const ok = window.confirm(`Delete role '${displayRole(roleKey)}'? This cannot be undone.`);
    if (!ok) return;
    setDeletingRole(roleKey);
    setSaveError("");
    try {
      await deleteMutation.mutateAsync(roleKey);
      // If we just deleted the active role, drop the local pending edits
      // for it and let the effect above re-pick a default.
      setPending((prev) => { const n = { ...prev }; delete n[roleKey]; return n; });
      if (activeRole === roleKey) setActiveRole("");
    } catch (e) {
      setSaveError(e.message || "Failed to delete role");
    } finally {
      setDeletingRole("");
    }
  }

  // ── Bulk menu actions ──────────────────────────────────────────────
  function handleBulk(action) {
    setBulkOpen(false);
    if (!isAdmin || !activeRole) return;
    if (action === "setall-edit" || action === "setall-view" || action === "setall-none") {
      const lvl = action.split("-")[1];
      if (view === "matrix") bulkSetLevelAllRoles(lvl);
      else bulkSetLevelForRole(activeRole, lvl);
      return;
    }
    if (action === "reset") {
      // Drop pending edits for the active role; saved values remain.
      setPending((prev) => { const n = { ...prev }; delete n[activeRole]; return n; });
    }
  }

  // ── Render ─────────────────────────────────────────────────────────
  const totalModules = features.length;

  return (
    <div className="acc-root">
      {/* Top header */}
      <div className="acc-topbar">
        <div>
          <div className="acc-crumbs">System · Security</div>
          <h1 className="acc-h1">Access Control Center</h1>
          <p className="acc-lede">
            Manage roles and module-level access across your Zoree workspace.
            {totalModules > 0 && <> · {totalModules} modules</>}
          </p>
        </div>
        <div className="acc-actions">
          <button
            type="button"
            className="acc-btn primary"
            onClick={() => { setCreateError(""); setShowAdd(true); }}
            disabled={!isAdmin || loading}
            title={!isAdmin ? "Admin role required" : ""}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add role
          </button>
        </div>
      </div>

      {/* Top tabs (Roles is the active tab; Users / Policies / API Access are placeholders) */}
      <div className="acc-tabs">
        <button type="button" className="acc-tab" disabled title="Coming soon">
          Users
        </button>
        <button type="button" className="acc-tab active">
          Roles <span className="count">{sortedRoleKeys.length}</span>
        </button>
        <button type="button" className="acc-tab" disabled title="Coming soon">
          Policies
        </button>
        <button type="button" className="acc-tab" disabled title="Coming soon">
          API Access
        </button>
      </div>

      {/* Alerts */}
      <div style={{ padding: "0 28px" }}>
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
      </div>

      {/* Two-pane body */}
      <div className="acc-pane">

        <RolesRail
          roleKeys={sortedRoleKeys}
          selected={activeRole}
          onSelect={setActiveRole}
          displayName={displayRole}
          isSystemRole={isSystemRole}
          isLocked={isLockedRole}
          userCount={userCountFor}
          canManage={isAdmin}
          onAdd={() => { setCreateError(""); setShowAdd(true); }}
          onClone={() => alert("Clone role: coming soon — backend support pending.")}
        />

        <section className="acc-panel">
          {activeRole && (
            <RoleHeader
              roleKey={activeRole}
              displayName={displayRole(activeRole)}
              description={descriptionFor(activeRole)}
              isSystem={isSystemRole(activeRole)}
              isLocked={isLockedRole(activeRole)}
              userCount={userCountFor(activeRole)}
              counts={counts}
              canManage={isAdmin}
              onDescriptionChange={(v) => setDescDraft((d) => ({ ...d, [activeRole]: v }))}
              onDelete={
                isAdmin && !isSystemRole(activeRole)
                  ? () => handleDeleteRole(activeRole)
                  : undefined
              }
            />
          )}

          {/* View switch + search + bulk */}
          <div className="acc-view-bar">
            <ViewSwitcher value={view} onChange={setView} />

            <div className="acc-search-row">
              <div className="acc-search">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  type="search"
                  placeholder="Search permissions…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div className="acc-menu-wrap">
                <button
                  type="button"
                  className="acc-btn"
                  onClick={() => setBulkOpen((v) => !v)}
                  disabled={!isAdmin || !activeRole}
                  title={!isAdmin ? "Admin role required" : ""}
                >
                  Bulk
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                {bulkOpen && (
                  <div className="acc-menu">
                    <button type="button" onClick={() => handleBulk("setall-edit")}>Set all visible to Edit</button>
                    <button type="button" onClick={() => handleBulk("setall-view")}>Set all visible to View</button>
                    <button type="button" onClick={() => handleBulk("setall-none")}>Set all visible to Hidden</button>
                    <hr />
                    <button type="button" className="danger" onClick={() => handleBulk("reset")}>
                      Reset pending edits
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Active view */}
          {view === "detail" && (
            <PermissionsView
              sections={sections}
              roleKey={activeRole}
              isLocked={isLockedRole(activeRole)}
              canEdit={isAdmin}
              levelFor={effectiveLevel}
              isPendingCell={isPendingCell}
              onLevelChange={handleLevelChange}
            />
          )}
          {view === "heat" && (
            <HeatmapView
              sections={sections}
              roleKeys={sortedRoleKeys}
              displayName={displayRole}
              isLocked={isLockedRole}
              canEdit={isAdmin}
              levelFor={effectiveLevel}
              onLevelChange={handleLevelChange}
            />
          )}
          {view === "matrix" && (
            <MatrixView
              sections={sections}
              roleKeys={sortedRoleKeys}
              displayName={displayRole}
              isSystemRole={isSystemRole}
              isLocked={isLockedRole}
              canEdit={isAdmin}
              levelFor={effectiveLevel}
              isPendingCell={isPendingCell}
              onLevelChange={handleLevelChange}
            />
          )}

          {loading && (
            <div style={{ padding: 18, color: "var(--acc-muted)", fontSize: 13 }}>
              Loading roles…
            </div>
          )}
        </section>
      </div>

      {/* Save bar */}
      <SaveBar
        pendingCount={pendingCount}
        saving={saving}
        disabled={!isAdmin}
        onDiscard={handleDiscardPending}
        onSave={handleSavePending}
      />

      {/* Existing modal — kept as-is. */}
      <AddRoleModal
        open={showAdd}
        busy={createMutation.isPending}
        errorText={createError}
        existingRoleKeys={sortedRoleKeys}
        onClose={() => setShowAdd(false)}
        onCreate={handleCreate}
      />

      {/* If `deletingRole` is set we briefly disable the corresponding
          Delete button via the spinner indicator that lives in
          RoleHeader's onDelete handler chain. Nothing to render here. */}
      {deletingRole && null}
    </div>
  );
}
