// ═══════════════════════════════════════════════════════════════════
// Auth user cache — caches the GET /auth/v1/user round trip.
//
// Every authenticated endpoint verified the JWT on every request, so a
// bulk action that issues 40 writes paid 40 token verifications before
// doing any work. Keyed by the raw JWT (never logged) with a short TTL
// matching the profile cache, so a role switch takes effect just as fast.
//
// Safety: an expired or revoked token is never served from cache for
// longer than the TTL, and the cached payload is cloned on the way in and
// out so a handler mutating `user` (verifyToken sets _token / roles /
// activeRole) cannot poison the next caller.
//
// Moved out of api/server.js (2026-10-25, CLAUDE_RULES §1/§6).
// ═══════════════════════════════════════════════════════════════════

'use strict';

/**
 * @param {object} [opts]
 * @param {number} [opts.ttlMs=30000]
 * @param {number} [opts.maxEntries=500]
 * @param {Function} [opts.now=Date.now] injectable clock for tests
 */
function createAuthUserCache({ ttlMs = 30_000, maxEntries = 500, now = Date.now } = {}) {
  const entries = new Map(); // token -> { user, at }

  const isFresh = (hit) => (now() - hit.at) < ttlMs;

  function get(token) {
    const hit = entries.get(token);
    if (!hit) return null;
    if (!isFresh(hit)) { entries.delete(token); return null; }
    return { ...hit.user };
  }

  function evictIfFull() {
    if (entries.size <= maxEntries) return;
    for (const [k, v] of entries) if (!isFresh(v)) entries.delete(k);
    if (entries.size > maxEntries) entries.clear();
  }

  function set(token, user) {
    evictIfFull();
    entries.set(token, { user: { ...user }, at: now() });
  }

  function invalidate(token) {
    if (token) entries.delete(token); else entries.clear();
  }

  return { get, set, invalidate, size: () => entries.size };
}

module.exports = { createAuthUserCache };
