// ════════════════════════════════════════════════════════════════════
// ApiAccessPage — QA bug #261c.
//
// Admin surface for programmatic-access tokens (the alternative to a
// user JWT for batch jobs, integrations, EDI senders, BI exporters).
// Wraps the /api/api-keys endpoints exposed by api/routes/apiKeys.js.
//
// Two flows:
//
//   1. List + revoke
//      Renders one row per key with prefix, role, status, created/
//      last-used, and a Revoke button. Revoked keys stay visible
//      (greyed) so admins can audit who issued what when.
//
//   2. Create
//      Modal with name + role inputs. On success the server returns
//      the raw token ONCE — we render it in a copy-to-clipboard panel
//      with a "save this now" warning and a hard acknowledgement
//      checkbox before the modal can close. The page state then
//      re-fetches the list so the new row appears.
//
// The page is admin-gated server-side (every endpoint checks role),
// and gated client-side via RoleGuard on the route. Non-admins see
// the RoleGuard fallback, not this component.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import "../components/access-control/access-control.css";
import { ApiKeysApi } from "../lib/api";

const ROLE_OPTIONS = [
  { key: "viewer",  label: "Viewer (read-only)" },
  { key: "planner", label: "Planner" },
  { key: "finance", label: "Finance" },
  { key: "admin",   label: "Admin (full access)" },
];

function formatDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function StatusChip({ status }) {
  const isActive = status === "active";
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 10px",
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 600,
      color: isActive ? "#059669" : "#94A3B8",
      background: isActive ? "rgba(5,150,105,0.10)" : "rgba(148,163,184,0.12)",
      border: `1px solid ${isActive ? "rgba(5,150,105,0.25)" : "rgba(148,163,184,0.25)"}`,
    }}>{isActive ? "Active" : "Revoked"}</span>
  );
}

export default function ApiAccessPage() {
  const [keys, setKeys]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState("");
  const [msg, setMsg]         = useState("");

  // Create-modal state.
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr]   = useState("");
  const [form, setForm]             = useState({ name: "", role: "viewer" });

  // Show-once secret display state.
  const [newSecret, setNewSecret] = useState(null); // { rawToken, key }
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);

  // In-progress revoke ids (so the matching row's button can disable).
  const [revokingId, setRevokingId] = useState("");

  async function refresh() {
    setLoading(true); setErr("");
    try {
      const res = await ApiKeysApi.list();
      setKeys(Array.isArray(res?.keys) ? res.keys : []);
    } catch (e) {
      setErr(e?.message || "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  function openCreate() {
    setForm({ name: "", role: "viewer" });
    setCreateErr("");
    setCreateOpen(true);
  }
  function closeCreate() {
    if (createBusy) return;
    setCreateOpen(false);
  }
  function closeSecret() {
    if (!acknowledged) return;
    setNewSecret(null);
    setAcknowledged(false);
    setCopied(false);
    refresh();
  }

  async function handleCreate(e) {
    e?.preventDefault?.();
    if (createBusy) return;
    setCreateErr("");
    const name = form.name.trim();
    const role = form.role;
    if (!name) { setCreateErr("Name is required."); return; }
    if (!ROLE_OPTIONS.find((o) => o.key === role)) {
      setCreateErr("Pick a valid role.");
      return;
    }
    setCreateBusy(true);
    try {
      const res = await ApiKeysApi.create({ name, role });
      if (!res?.rawToken) {
        throw new Error("Server did not return a token. The key may not have been created.");
      }
      setCreateOpen(false);
      setNewSecret({ rawToken: res.rawToken, key: res.key });
    } catch (e2) {
      setCreateErr(e2?.message || "Failed to create API key");
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleRevoke(k) {
    if (!k?.id || k.status !== "active") return;
    if (!window.confirm(`Revoke API key "${k.name}"? This cannot be undone — any client using it will start receiving 401s.`)) return;
    setRevokingId(k.id);
    setMsg("");
    try {
      await ApiKeysApi.revoke(k.id);
      setMsg(`Revoked "${k.name}".`);
      await refresh();
    } catch (e) {
      setErr(e?.message || "Failed to revoke key");
    } finally {
      setRevokingId("");
      setTimeout(() => setMsg(""), 4000);
    }
  }

  async function copySecret() {
    if (!newSecret?.rawToken) return;
    try {
      await navigator.clipboard.writeText(newSecret.rawToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback for non-secure contexts: select-the-text-and-prompt.
      window.prompt("Copy your API key:", newSecret.rawToken);
    }
  }

  const summary = useMemo(() => {
    const total    = keys.length;
    const active   = keys.filter((k) => k.status === "active").length;
    const revoked  = total - active;
    return { total, active, revoked };
  }, [keys]);

  return (
    <div style={{ padding: "24px 28px 64px" }}>
      {/* Page header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>API Access</h1>
          <p style={{ fontSize: 13, color: "var(--text2, #475569)", margin: "6px 0 0", maxWidth: 760 }}>
            Issue programmatic-access tokens for integrations, batch jobs, and BI exporters.
            Clients authenticate by sending <code>Authorization: ApiKey &lt;token&gt;</code>.
            A token's role is fixed at creation and cannot be changed — to change role, revoke and re-issue.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={openCreate}
          disabled={loading}
        >
          + New API key
        </button>
      </div>

      {/* Top tabs */}
      <div className="acc-tabs">
        <Link to="/user-management" className="acc-tab" style={{ textDecoration: "none" }}>Users</Link>
        <Link to="/user-roles"      className="acc-tab" style={{ textDecoration: "none" }}>Roles</Link>
        <Link to="/policies"        className="acc-tab" style={{ textDecoration: "none" }}>Policies</Link>
        <button type="button" className="acc-tab active">
          API Access <span className="count">{summary.active}</span>
        </button>
      </div>

      {/* Summary strip */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 12,
        margin: "18px 0 20px",
      }}>
        <div className="stat-card blue">
          <div className="stat-label">Total keys</div>
          <div className="stat-value" style={{ fontSize: 24 }}>{summary.total}</div>
        </div>
        <div className="stat-card green">
          <div className="stat-label">Active</div>
          <div className="stat-value" style={{ fontSize: 24 }}>{summary.active}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Revoked</div>
          <div className="stat-value" style={{ fontSize: 24 }}>{summary.revoked}</div>
        </div>
      </div>

      {/* Alerts */}
      {err && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <div className="alert-icon">⛔</div>
          <div className="alert-text">{err}</div>
        </div>
      )}
      {msg && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          <div className="alert-icon">ℹ️</div>
          <div className="alert-text">{msg}</div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ padding: 32, textAlign: "center", color: "var(--text2, #64748B)" }}>
          Loading API keys…
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="grid" style={{ border: "none", boxShadow: "none" }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Prefix</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th style={{ width: 110 }}></th>
                </tr>
              </thead>
              <tbody>
                {keys.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--text3, #94A3B8)" }}>
                      No API keys yet. Create one to grant programmatic access.
                    </td>
                  </tr>
                ) : (
                  keys.map((k) => (
                    <tr key={k.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{k.name}</div>
                      </td>
                      <td>
                        <code style={{ fontSize: 12, color: "var(--text2, #475569)" }}>
                          {k.keyPrefix}…
                        </code>
                      </td>
                      <td style={{ fontSize: 12 }}>{k.role}</td>
                      <td><StatusChip status={k.status} /></td>
                      <td style={{ fontSize: 12, color: "var(--text2, #475569)" }}>
                        {formatDateTime(k.createdAt)}
                      </td>
                      <td style={{ fontSize: 12, color: "var(--text2, #475569)" }}>
                        {formatDateTime(k.lastUsedAt)}
                      </td>
                      <td>
                        {k.status === "active" ? (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleRevoke(k)}
                            disabled={revokingId === k.id}
                          >
                            {revokingId === k.id ? "Revoking…" : "Revoke"}
                          </button>
                        ) : (
                          <span style={{ fontSize: 11, color: "var(--text3, #94A3B8)" }}>
                            {formatDateTime(k.revokedAt)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Create modal ───────────────────────────────────────────── */}
      {createOpen && (
        <div className="modal-overlay" onClick={closeCreate}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>New API key</h3>
              <button type="button" className="modal-close" onClick={closeCreate} disabled={createBusy}>×</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body" style={{ display: "grid", gap: 14 }}>
                {createErr && (
                  <div className="alert alert-danger">
                    <div className="alert-icon">⛔</div>
                    <div className="alert-text">{createErr}</div>
                  </div>
                )}

                <label className="form-field">
                  <span className="form-label">Name</span>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. EDI ingest, Snowflake exporter, ZBI-2"
                    disabled={createBusy}
                    autoFocus
                    required
                  />
                  <span className="form-help">
                    Descriptive label only — used in the admin list, not transmitted to the API.
                  </span>
                </label>

                <label className="form-field">
                  <span className="form-label">Role</span>
                  <select
                    value={form.role}
                    onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                    disabled={createBusy}
                  >
                    {ROLE_OPTIONS.map((o) => (
                      <option key={o.key} value={o.key}>{o.label}</option>
                    ))}
                  </select>
                  <span className="form-help">
                    The key authenticates as this role for every request. Choose the least privilege
                    that still gets the job done.
                  </span>
                </label>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn" onClick={closeCreate} disabled={createBusy}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={createBusy}>
                  {createBusy ? "Creating…" : "Create key"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Show-once secret modal ─────────────────────────────────── */}
      {newSecret && (
        <div className="modal-overlay" onClick={() => acknowledged && closeSecret()}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header" style={{ background: "#059669" }}>
              <h3>Save this key now</h3>
            </div>
            <div className="modal-body" style={{ display: "grid", gap: 14 }}>
              <div className="alert alert-warning">
                <div className="alert-icon">⚠️</div>
                <div className="alert-text">
                  This is the only time you'll see the full key.
                  The server stores only a hash — if you lose it, you'll need to revoke and re-issue.
                </div>
              </div>

              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2, #475569)", marginBottom: 6 }}>
                  {newSecret.key?.name || "API key"} — {newSecret.key?.role}
                </div>
                <div style={{
                  background: "#0F172A",
                  color: "#F1F5F9",
                  padding: 14,
                  borderRadius: 10,
                  fontFamily: "monospace",
                  fontSize: 13,
                  wordBreak: "break-all",
                  border: "1px solid #1E293B",
                }}>
                  {newSecret.rawToken}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={copySecret}
                  style={{ marginTop: 10 }}
                >
                  {copied ? "✓ Copied" : "Copy to clipboard"}
                </button>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                I've saved this key somewhere secure.
              </label>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-primary"
                onClick={closeSecret}
                disabled={!acknowledged}
                title={!acknowledged ? "Tick the box first" : ""}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
