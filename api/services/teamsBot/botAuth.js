// ═══════════════════════════════════════════════════════════════════
// Bot Framework auth — zero new dependencies.
//
// Two directions:
//   1. INBOUND  — Teams → us. Every activity POST carries a JWT signed
//      by the Bot Framework. We validate it against the published JWKS
//      (jsonwebtoken + Node crypto JWK import — no jwks-rsa needed).
//   2. OUTBOUND — us → Teams. Replies are POSTed to the activity's
//      serviceUrl with a client-credentials token from Entra ID.
//
// Dev mode: when TEAMS_BOT_APP_ID is unset, inbound validation is
// skipped with a loud warning (same no-op-when-unset idiom as
// requireIngestKey). Never run that way in production.
//
// Env:
//   TEAMS_BOT_APP_ID       — Azure Bot's Microsoft App ID
//   TEAMS_BOT_APP_PASSWORD — its client secret
// ═══════════════════════════════════════════════════════════════════

'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { debugLog } = require('./debugLog');

const APP_ID = process.env.TEAMS_BOT_APP_ID || '';
const APP_PASSWORD = process.env.TEAMS_BOT_APP_PASSWORD || '';
// Single-tenant bot apps must mint connector tokens from their own
// tenant authority; multi-tenant bots use the shared botframework.com
// authority. Set TEAMS_BOT_TENANT_ID when the app registration is
// single-tenant (symptom: replies fail with 401 "Authorization has
// been denied for this request").
const TENANT_ID = process.env.TEAMS_BOT_TENANT_ID || '';

const OPENID_CONFIG_URL = 'https://login.botframework.com/v1/.well-known/openidconfiguration';
const TOKEN_URL = TENANT_ID
  ? `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`
  : 'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token';
const EXPECTED_ISSUER = 'https://api.botframework.com';

function isConfigured() {
  return !!(APP_ID && APP_PASSWORD);
}

// ── Inbound: JWKS cache (refetched daily or on unknown kid) ────────
let jwksCache = { keys: [], fetchedAt: 0 };
const JWKS_TTL_MS = 24 * 60 * 60 * 1000;

async function fetchJwks() {
  const cfgRes = await fetch(OPENID_CONFIG_URL);
  if (!cfgRes.ok) throw new Error(`OpenID config fetch failed (${cfgRes.status})`);
  const cfg = await cfgRes.json();
  const keysRes = await fetch(cfg.jwks_uri);
  if (!keysRes.ok) throw new Error(`JWKS fetch failed (${keysRes.status})`);
  const { keys } = await keysRes.json();
  jwksCache = { keys: keys || [], fetchedAt: Date.now() };
  return jwksCache.keys;
}

async function getSigningKeyPem(kid) {
  let keys = jwksCache.keys;
  if (!keys.length || Date.now() - jwksCache.fetchedAt > JWKS_TTL_MS) {
    keys = await fetchJwks();
  }
  let jwk = keys.find((k) => k.kid === kid);
  if (!jwk) {
    // key rotation — refetch once
    keys = await fetchJwks();
    jwk = keys.find((k) => k.kid === kid);
  }
  if (!jwk) throw new Error(`No JWKS key for kid ${kid}`);
  return crypto
    .createPublicKey({ key: jwk, format: 'jwk' })
    .export({ type: 'spki', format: 'pem' });
}

/**
 * Validate the Authorization header of an inbound Bot Framework request.
 * Returns { ok, devMode?, error? }. Never throws.
 */
async function verifyInboundRequest(authHeader) {
  if (!APP_ID) {
    // Dev mode (e.g. Bot Framework Emulator with no credentials)
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, error: 'TEAMS_BOT_APP_ID not set — refusing unauthenticated bot traffic in production' };
    }
    console.warn('[teamsBot] ⚠ inbound auth SKIPPED (TEAMS_BOT_APP_ID unset — dev mode only)');
    return { ok: true, devMode: true };
  }
  try {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { ok: false, error: 'Missing Bearer token' };
    }
    const token = authHeader.slice(7);
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || !decoded.header || !decoded.header.kid) {
      return { ok: false, error: 'Malformed token' };
    }
    const pem = await getSigningKeyPem(decoded.header.kid);
    jwt.verify(token, pem, {
      audience: APP_ID,
      issuer: EXPECTED_ISSUER,
      clockTolerance: 300,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

// ── Outbound: connector token cache ────────────────────────────────
let tokenCache = { token: null, expiresAt: 0 };

async function getConnectorToken() {
  if (!isConfigured()) {
    // Loud: a silent null here is exactly what produces a 401 on reply.
    console.warn('[teamsBot] no connector token — TEAMS_BOT_APP_ID/PASSWORD missing at module load');
    debugLog('TOKEN_SKIPPED', { appIdSet: !!APP_ID, secretSet: !!APP_PASSWORD });
    return null;
  }
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: APP_ID,
    client_secret: APP_PASSWORD,
    scope: 'https://api.botframework.com/.default',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    debugLog('TOKEN_FAIL', { status: res.status, authority: TOKEN_URL, body: text.slice(0, 300) });
    throw new Error(`Connector token failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + ((data.expires_in || 3600) - 60) * 1000,
  };
  debugLog('TOKEN_OK', { authority: TOKEN_URL, expiresIn: data.expires_in });
  return tokenCache.token;
}

module.exports = { isConfigured, verifyInboundRequest, getConnectorToken };
