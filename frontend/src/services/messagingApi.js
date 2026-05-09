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
// ═══════════════════════════════════════════════════════════════════

const BASE = "/api/messaging-hub";

async function _fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...options,
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
