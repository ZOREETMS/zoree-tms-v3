// ════════════════════════════════════════════════════════════════════
// zoreeApiClient.js — thin HTTP client for the ZoreeTMS Express API.
//
// The MCP server never talks to Supabase directly. Every read goes
// through the Express API so tenant scoping, role checks and the
// change-audit pipeline keep applying exactly as they do for the web
// app. The caller's credential is forwarded as-is:
//   • Supabase session JWT (from the OAuth login)  → Bearer <jwt>
//   • ZoreeTMS API key (Settings → API Keys)        → ApiKey <key>
// ════════════════════════════════════════════════════════════════════

const REQUEST_TIMEOUT_MS = 30_000;

class ZoreeApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ZoreeApiError';
    this.status = status;
  }
}

/** JWTs have three dot-separated base64url parts; API keys have none. */
function authHeaderFor(token) {
  const t = String(token || '');
  return t.split('.').length === 3 ? `Bearer ${t}` : `ApiKey ${t}`;
}

function createZoreeApiClient({ apiUrl, token, fetchImpl = fetch }) {
  if (!apiUrl) throw new Error('createZoreeApiClient: apiUrl is required');

  async function request(method, path, { query, body } = {}) {
    const url = new URL(apiUrl + path);
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = authHeaderFor(token);
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new ZoreeApiError(502, `ZoreeTMS API unreachable: ${err.message}`);
    }

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
      throw new ZoreeApiError(res.status, msg);
    }
    return data;
  }

  return {
    get: (path, query) => request('GET', path, { query }),
    post: (path, body) => request('POST', path, { body }),
    patch: (path, body) => request('PATCH', path, { body }),
    delete: (path) => request('DELETE', path),
  };
}

module.exports = { createZoreeApiClient, ZoreeApiError, authHeaderFor };
