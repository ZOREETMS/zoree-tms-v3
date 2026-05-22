// ═══════════════════════════════════════════════════════════════════
// Messaging Hub — HTTP client.
//
// Per CLAUDE_RULES §4 every API call goes through the services layer.
// UI components MUST NOT call fetch directly; they go through
// hooks/useMessaging.js, which goes through this module.
//
// Endpoints (see api/routes/messagingHub.js):
//   GET  /api/messaging-hub/messages
//   GET  /api/messaging-hub/messages/:id
//   GET  /api/messaging-hub/kpis
//   POST /api/messaging-hub/messages/:id/retry
//   POST /api/messaging-hub/compose
//
// All functions return a Promise that resolves to the parsed body.
// On non-2xx the function throws an Error with a `.status` and a
// `.body` property so the hook can react granularly.
//
// Bug fix (2026-05-17): the original implementation hard-coded
// `BASE = "/api/messaging-hub"` as a relative URL. In dev the Vite
// server (:5173) has no `/api` proxy and in any deployment where the
// SPA and Express API are on different origins, that relative request
// resolves against the SPA origin and returns `index.html` — the JSON
// parse silently yields `{}`, so the Messaging Hub page sat empty even
// though `message_log` was populated. Every other feature reaches the
// API through `lib/api.js` which resolves an absolute base URL from
// `VITE_API_BASE` / `window.ZOREE_API_URL`. This module now mirrors
// that resolution rule so the Hub talks to the same API as the rest of
// the app, and forwards the auth bearer token so a future
// `verifyToken` on these routes will Just Work.
// ═══════════════════════════════════════════════════════════════════

// Match the normalization in `frontend/src/lib/api.js` so both modules
// agree on what `${API_BASE}/...` means. Always ends with exactly one
// `/api` segment.
function _normalizeApiBase(raw) {
  let b = String(raw || "").trim();
  if (!b) b = "http://localhost:3001";
  b = b.replace(/\/+$/, "").replace(/\/api$/i, "");
  return `${b}/api`;
}

const API_BASE = _normalizeApiBase(
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE)
    || (typeof window !== "undefined" && window.ZOREE_API_URL)
    || "http://localhost:3001/api"
);

const BASE = `${API_BASE}/messaging-hub`;

function _authToken() {
  try { return localStorage.getItem("zoree_token") || ""; }
  catch { return ""; }
}

async function _fetchJson(url, options = {}) {
  const token = _authToken();
  // NOTE: do NOT set `credentials: "include"` here. The Express API runs
  // `cors({ origin: '*', credentials: true })` (api/server.js), and the
  // browser refuses any credentialed response whose
  // `Access-Control-Allow-Origin` is the `*` wildcard — it blocks the
  // response before this code sees it, so every Hub fetch failed silently
  // and the page sat blank even though `message_log` was populated.
  // Auth travels via the Authorization bearer header below, which CORS
  // permits without credentials mode; this matches lib/api.js, the
  // resolution every other (working) feature uses.
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  let body = null;
  try { body = await res.json(); } catch { /* may be empty */ }
  if (!res.ok) {
    const err = new Error((body && body.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body || {};
}

function _qs(params) {
  const entries = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (!entries.length) return "";
  return "?" + entries.map(([k, v]) =>
    `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
  ).join("&");
}

export async function listMessages(filters = {}) {
  const data = await _fetchJson(`${BASE}/messages${_qs(filters)}`);
  return Array.isArray(data.messages) ? data.messages : [];
}

export async function getMessage(id) {
  const data = await _fetchJson(`${BASE}/messages/${encodeURIComponent(id)}`);
  return data.message || null;
}

export async function getKpis(filters = {}) {
  const data = await _fetchJson(`${BASE}/kpis${_qs(filters)}`);
  return data.kpis || {
    total: 0, outbound: 0, inbound: 0, delivered: 0, failed: 0, pending: 0,
  };
}

export async function retryMessage(id) {
  return _fetchJson(`${BASE}/messages/${encodeURIComponent(id)}/retry`, {
    method: "POST",
  });
}

export async function composeMessage(compose) {
  return _fetchJson(`${BASE}/compose`, {
    method: "POST",
    body: JSON.stringify(compose),
  });
}
