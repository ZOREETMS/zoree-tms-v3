// ═══════════════════════════════════════════════════════════════════
// UserManagementPage — REQ-08.
//
// Admin-only page for creating, editing and deleting TMS users.
// Accessed at /user-management (already listed under the System section
// of the sidebar via roleMatrix — admins only).
//
// The page lists every user and supports:
//   - Create user: email + password + full name + multi-select roles
//   - Edit roles: check/uncheck roles, save
//   - Reset password: inline
//   - Disable/Enable account
//   - Delete user (except yourself)
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "../state/AuthContext";
import { UsersApi } from "../lib/api";

const ROLE_OPTIONS = [
  { key: "admin",   label: "Admin",   color: "#7c3aed" },
  { key: "planner", label: "Planner", color: "#0d9488" },
  { key: "finance", label: "Finance", color: "#d97706" },
  { key: "viewer",  label: "Viewer",  color: "#64748b" },
];

function RoleChip({ role, small }) {
  const meta = ROLE_OPTIONS.find((o) => o.key === role) || { label: role, color: "#64748b" };
  return (
    <span style={{
      display: "inline-block",
      padding: small ? "2px 8px" : "3px 10px",
      borderRadius: 999,
      fontSize: small ? 10 : 11,
      fontWeight: 600,
      color: meta.color,
      background: `${meta.color}15`,
      border: `1px solid ${meta.color}40`,
      marginRight: 4,
      marginBottom: 2,
    }}>{meta.label}</span>
  );
}

function emptyForm() {
  return { email: "", password: "", fullName: "", roles: ["viewer"], activeRole: "viewer" };
}

export default function UserManagementPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null); // null=create, or user object
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function refresh() {
    setLoading(true); setErr("");
    try {
      const res = await UsersApi.list();
      setUsers(Array.isArray(res?.users) ? res.users : []);
    } catch (e) {
      setErr(e?.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setShowForm(true);
  }
  function openEdit(u) {
    setEditing(u);
    setForm({
      email: u.email || "",
      password: "",
      fullName: u.fullName || "",
      roles: Array.isArray(u.roles) && u.roles.length ? [...u.roles] : ["viewer"],
      activeRole: u.activeRole || (u.roles?.[0] || "viewer"),
    });
    setShowForm(true);
  }
  function toggleRole(r) {
    setForm((f) => {
      const on = f.roles.includes(r);
      const nextRoles = on ? f.roles.filter((x) => x !== r) : [...f.roles, r];
      const safeRoles = nextRoles.length ? nextRoles : ["viewer"];
      const nextActive = safeRoles.includes(f.activeRole) ? f.activeRole : safeRoles[0];
      return { ...f, roles: safeRoles, activeRole: nextActive };
    });
  }

  async function onSubmit(e) {
    e?.preventDefault?.();
    setBusy(true); setErr(""); setMsg("");
    try {
      if (editing) {
        const patch = {
          fullName: form.fullName,
          roles: form.roles,
          activeRole: form.activeRole,
        };
        if (form.password && form.password.trim()) patch.password = form.password.trim();
        await UsersApi.update(editing.id, patch);
        setMsg(`Updated ${editing.email}.`);
      } else {
        if (!form.email.trim() || !form.password.trim()) {
          throw new Error("Email and password are required");
        }
        await UsersApi.create({
          email: form.email.trim(),
          password: form.password,
          fullName: form.fullName || null,
          roles: form.roles,
          activeRole: form.activeRole,
        });
        setMsg(`Created ${form.email}.`);
      }
      setShowForm(false);
      await refresh();
    } catch (e2) {
      setErr(e2?.message || "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function toggleDisabled(u) {
    setBusy(true); setErr(""); setMsg("");
    try {
      await UsersApi.update(u.id, { disabled: !u.disabled });
      await refresh();
      setMsg(`${u.disabled ? "Enabled" : "Disabled"} ${u.email}.`);
    } catch (e) {
      setErr(e?.message || "Failed to update");
    } finally { setBusy(false); }
  }

  async function onDelete(u) {
    if (u.id === me?.id) { setErr("Cannot delete yourself."); return; }
    if (!window.confirm(`Delete user ${u.email}? This cannot be undone.`)) return;
    setBusy(true); setErr(""); setMsg("");
    try {
      await UsersApi.remove(u.id);
      await refresh();
      setMsg(`Deleted ${u.email}.`);
    } catch (e) {
      setErr(e?.message || "Failed to delete");
    } finally { setBusy(false); }
  }

  const sorted = useMemo(
    () => [...users].sort((a, b) => (a.email || "").localeCompare(b.email || "")),
    [users]
  );

  return (
    <div style={{ padding: "20px 24px", maxWidth: 1200 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div className="page-title" style={{ fontSize: 22, fontWeight: 700 }}>🔐 User Management</div>
          <div className="page-sub" style={{ fontSize: 12, color: "var(--text3)" }}>Admin-only. Create TMS users, assign one or more roles, and manage access.</div>
        </div>
        <button className="btn btn-primary" onClick={openCreate} disabled={busy} style={{ background: "linear-gradient(135deg,#1a237e,#6366f1)", border: "none" }}>
          + New User
        </button>
      </div>

      {err && <div style={{ padding: "10px 12px", background: "#fee2e2", color: "#991b1b", borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{err}</div>}
      {msg && <div style={{ padding: "10px 12px", background: "#dcfce7", color: "#14532d", borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{msg}</div>}

      <div style={{ background: "#fff", border: "1.5px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead style={{ background: "#f8faff" }}>
            <tr>
              <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.4 }}>Email</th>
              <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.4 }}>Name</th>
              <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.4 }}>Roles</th>
              <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.4 }}>Active</th>
              <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.4 }}>Status</th>
              <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.4 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ padding: 20, textAlign: "center", color: "var(--text3)" }}>Loading users…</td></tr>}
            {!loading && sorted.length === 0 && <tr><td colSpan={6} style={{ padding: 20, textAlign: "center", color: "var(--text3)" }}>No users found.</td></tr>}
            {sorted.map((u) => (
              <tr key={u.id} style={{ borderTop: "1px solid var(--border)", opacity: u.disabled ? 0.55 : 1 }}>
                <td style={{ padding: "10px 14px", fontFamily: "monospace" }}>{u.email}</td>
                <td style={{ padding: "10px 14px" }}>{u.fullName || <span style={{ color: "var(--text3)" }}>—</span>}</td>
                <td style={{ padding: "10px 14px" }}>
                  {u.roles && u.roles.length ? u.roles.map((r) => <RoleChip key={r} role={r} />) : <span style={{ color: "var(--text3)" }}>— no profile —</span>}
                </td>
                <td style={{ padding: "10px 14px" }}>{u.activeRole ? <RoleChip role={u.activeRole} /> : "—"}</td>
                <td style={{ padding: "10px 14px", fontSize: 11 }}>
                  {u.disabled
                    ? <span style={{ color: "#b45309", fontWeight: 600 }}>Disabled</span>
                    : <span style={{ color: "#0d9488", fontWeight: 600 }}>Active</span>}
                </td>
                <td style={{ padding: "10px 14px", textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => openEdit(u)} style={{ marginRight: 4 }}>Edit</button>
                  <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => toggleDisabled(u)} style={{ marginRight: 4 }}>{u.disabled ? "Enable" : "Disable"}</button>
                  <button disabled={busy || u.id === me?.id} onClick={() => onDelete(u)} style={{ background: "rgba(220,38,38,.08)", color: "#dc2626", border: "1px solid rgba(220,38,38,.2)", padding: "4px 8px", borderRadius: 6, fontSize: 12, cursor: "pointer" }} title={u.id === me?.id ? "Cannot delete yourself" : "Delete user"}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ width: 540, maxWidth: "92vw", background: "#fff", borderRadius: 16, boxShadow: "0 20px 50px rgba(0,0,0,.25)", overflow: "hidden" }}>
            <div style={{ padding: "16px 22px", background: "linear-gradient(135deg,#1a237e,#6366f1)", color: "#fff", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20 }}>{editing ? "🔧" : "➕"}</span>
              <div style={{ flex: 1, fontSize: 15, fontWeight: 700 }}>{editing ? `Edit ${editing.email}` : "Create new user"}</div>
              <button onClick={() => setShowForm(false)} style={{ background: "transparent", border: "none", color: "#fff", fontSize: 18, cursor: "pointer" }}>✕</button>
            </div>
            <form onSubmit={onSubmit} style={{ padding: "18px 22px" }}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: "var(--text3)", textTransform: "uppercase", marginBottom: 4 }}>Email</label>
                <input type="email" value={form.email} disabled={!!editing} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} style={{ width: "100%", padding: "9px 11px", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: 13 }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: "var(--text3)", textTransform: "uppercase", marginBottom: 4 }}>{editing ? "Reset password (leave blank to keep)" : "Password"}</label>
                <input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder={editing ? "• • • • • • • •" : "At least 6 characters"} style={{ width: "100%", padding: "9px 11px", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: 13 }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: "var(--text3)", textTransform: "uppercase", marginBottom: 4 }}>Full Name</label>
                <input type="text" value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} placeholder="e.g. Jane Smith" style={{ width: "100%", padding: "9px 11px", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: 13 }} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: "var(--text3)", textTransform: "uppercase", marginBottom: 6 }}>Roles (select one or more)</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {ROLE_OPTIONS.map((opt) => {
                    const on = form.roles.includes(opt.key);
                    return (
                      <button key={opt.key} type="button" onClick={() => toggleRole(opt.key)} style={{
                        padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                        color: on ? "#fff" : opt.color,
                        background: on ? opt.color : `${opt.color}15`,
                        border: `1.5px solid ${opt.color}${on ? "" : "40"}`,
                      }}>{on ? "✓ " : ""}{opt.label}</button>
                    );
                  })}
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: "var(--text3)", textTransform: "uppercase", marginBottom: 4 }}>Default active role</label>
                <select value={form.activeRole} onChange={(e) => setForm((f) => ({ ...f, activeRole: e.target.value }))} style={{ width: "100%", padding: "9px 11px", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: 13, background: "#fff" }}>
                  {form.roles.map((r) => <option key={r} value={r}>{ROLE_OPTIONS.find((o) => o.key === r)?.label || r}</option>)}
                </select>
              </div>

              {err && <div style={{ padding: "8px 10px", background: "#fee2e2", color: "#991b1b", borderRadius: 6, marginBottom: 10, fontSize: 12 }}>{err}</div>}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)} disabled={busy}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy} style={{ background: "linear-gradient(135deg,#1a237e,#6366f1)", border: "none" }}>
                  {busy ? "Saving…" : (editing ? "Save Changes" : "Create User")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
