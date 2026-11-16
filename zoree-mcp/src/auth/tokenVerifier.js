// ════════════════════════════════════════════════════════════════════
// tokenVerifier.js — validates the bearer token on every /mcp request.
//
// Accepts either credential the ZoreeTMS API already understands:
//   • a Supabase session JWT issued through the OAuth login flow
//   • a ZoreeTMS API key (Settings → API Keys), for Claude Code /
//     Claude API clients that send a static header
// Validation is delegated to the API's own GET /api/auth/me, so a
// disabled user or revoked key is rejected here too. Results are cached
// for 30 s (keyed by a hash of the token, never the token itself).
// ════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { InvalidTokenError } = require('@modelcontextprotocol/sdk/server/auth/errors.js');
const { createZoreeApiClient } = require('../services/zoreeApiClient');

const CACHE_TTL_MS = 30_000;
const API_KEY_EXPIRY_SECONDS = 3600; // re-checked via cache TTL anyway

function jwtExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

function createTokenVerifier({ apiUrl, scopes, fetchImpl }) {
  const cache = new Map(); // sha256(token) -> { info, at }

  async function verifyAccessToken(token) {
    if (!token) throw new InvalidTokenError('Missing token');
    const key = crypto.createHash('sha256').update(token).digest('hex');
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.info;

    const isJwt = token.split('.').length === 3;
    const exp = isJwt ? jwtExpiry(token) : Math.floor(Date.now() / 1000) + API_KEY_EXPIRY_SECONDS;
    if (isJwt && exp && exp < Date.now() / 1000) throw new InvalidTokenError('Token has expired');

    let me;
    try {
      me = await createZoreeApiClient({ apiUrl, token, fetchImpl }).get('/api/auth/me');
    } catch (err) {
      cache.delete(key);
      if (err.status === 401 || err.status === 403) throw new InvalidTokenError(err.message);
      throw err; // API down → 500, not a forced re-login
    }

    const user = (me && me.user) || {};
    const info = {
      token,
      clientId: isJwt ? 'zoree-oauth' : 'zoree-api-key',
      scopes,
      expiresAt: exp || Math.floor(Date.now() / 1000) + 300,
      extra: { userId: user.id, email: user.email, role: user.activeRole || user.role },
    };
    cache.set(key, { info, at: Date.now() });
    return info;
  }

  return { verifyAccessToken };
}

module.exports = { createTokenVerifier, jwtExpiry };
