// ═══════════════════════════════════════════════════════════════════
// TMS API client for the Teams bot.
//
// The bot acts as a real TMS user (a dedicated Supabase account with
// planner or admin role) so every action it performs flows through the
// SAME authenticated endpoints, role gates, and change_history audit
// trail as the web/mobile clients. Nothing bypasses verifyToken.
//
// Sign-in: Supabase password grant with the anon key, token cached and
// refreshed ~1 min before expiry. Calls go to the local server itself
// (TEAMS_BOT_API_BASE, default http://localhost:<PORT>/api).
//
// Env:
//   TEAMS_BOT_TMS_EMAIL     — dedicated bot user (create in Supabase Auth)
//   TEAMS_BOT_TMS_PASSWORD  — its password
//   TEAMS_BOT_API_BASE      — override API base (default localhost:PORT)
// ═══════════════════════════════════════════════════════════════════

'use strict';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ljbeihotrmyqthxptcgp.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const BOT_EMAIL = process.env.TEAMS_BOT_TMS_EMAIL || '';
const BOT_PASSWORD = process.env.TEAMS_BOT_TMS_PASSWORD || '';
const API_BASE = (
  process.env.TEAMS_BOT_API_BASE ||
  `http://localhost:${process.env.PORT || 3001}/api`
).replace(/\/+$/, '');

function isConfigured() {
  return !!(BOT_EMAIL && BOT_PASSWORD);
}

// ── Token cache ────────────────────────────────────────────────────
let cached = { token: null, expiresAt: 0 };

async function signIn() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email: BOT_EMAIL, password: BOT_PASSWORD }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Bot TMS sign-in failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  cached = {
    token: data.access_token,
    // refresh 60s early; default lifetime 3600s
    expiresAt: Date.now() + ((data.expires_in || 3600) - 60) * 1000,
  };
  return cached.token;
}

async function getToken() {
  if (!isConfigured()) {
    const err = new Error(
      'Teams bot has no TMS credentials. Set TEAMS_BOT_TMS_EMAIL / TEAMS_BOT_TMS_PASSWORD in api/.env ' +
      '(create a dedicated planner-role user in Supabase Auth).'
    );
    err.status = 503;
    throw err;
  }
  if (cached.token && Date.now() < cached.expiresAt) return cached.token;
  return signIn();
}

// ── Generic API call (one retry on 401 with fresh sign-in) ─────────
async function api(method, path, body) {
  let token = await getToken();
  const doFetch = (t) =>
    fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${t}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let res = await doFetch(token);
  if (res.status === 401) {
    token = await signIn();
    res = await doFetch(token);
  }
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(
      (data && data.error) ? data.error : `${method} ${path} failed (${res.status})`
    );
    err.status = res.status;
    throw err;
  }
  return data;
}

module.exports = {
  isConfigured,
  api,
  get: (path) => api('GET', path),
  post: (path, body) => api('POST', path, body),
  patch: (path, body) => api('PATCH', path, body),
};
