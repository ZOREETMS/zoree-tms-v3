// ════════════════════════════════════════════════════════════════════
// apiKeys.js — service layer for the `api_keys` table.
// QA bug #261c.
//
// Surface area:
//   • generateRawToken()          — create a fresh random token string
//   • hashToken(raw)              — sha-256 hex of the raw token
//   • createApiKey({ … })         — insert a row, return { row, rawToken }
//   • listApiKeysForTenant(tid)   — admin list view; never includes hash
//   • revokeApiKey({ id, … })     — soft-delete (sets revoked_at/by)
//   • verifyApiKey(rawToken)      — authenticate a raw token →
//                                   resolved user-like context or null
//
// The route layer (api/routes/apiKeys.js) is a thin shell over these
// functions; the middleware fast-path in api/server.js verifyToken()
// calls verifyApiKey() directly.
//
// Caching: verifyApiKey() uses a 60-second in-memory TTL cache keyed
// on the token hash so the auth middleware can avoid hitting the DB
// on every request. Revokes invalidate the cache for the affected
// hash so the next call after a revoke sees the dead state without
// waiting out the TTL.
// ════════════════════════════════════════════════════════════════════

const crypto = require('crypto');

const TOKEN_BYTES = 32;       // 256 bits
const PREFIX_LEN  = 8;        // chars shown to the admin in lists

// ── Token generation + hashing ──────────────────────────────────────

/** Return a fresh raw token (base64url, ~43 chars). */
function generateRawToken() {
  // base64url is URL-safe and avoids the +/ characters that confuse
  // shell pipelines and HTTP headers in some clients.
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

/** sha-256(raw_token) → lower-case hex. */
function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

function prefixOf(raw) {
  return String(raw).slice(0, PREFIX_LEN);
}

// ── Persistence helpers ─────────────────────────────────────────────
//
// dbInsert / dbSelect / dbUpdate are the same Supabase service-role
// helpers used elsewhere in the API. Injected via createApiKeysService
// so this module stays test-friendly (the unit tests pass in fakes).

function createApiKeysService({ dbSelect, dbUpsert, dbUpdate }) {
  // Note: the host server.js exposes dbUpsert (PostgREST POST with
  // resolution=merge-duplicates on id), which behaves like INSERT for
  // a payload without an id. We use it as our insert primitive here
  // so the service has the same shape as the rest of api/services/*.
  if (typeof dbSelect !== 'function' || typeof dbUpsert !== 'function' || typeof dbUpdate !== 'function') {
    throw new Error('createApiKeysService: dbSelect, dbUpsert, and dbUpdate are required');
  }

  // ── 60s in-memory cache for verifyApiKey ──────────────────────────
  const VERIFY_TTL_MS = 60_000;
  const verifyCache = new Map(); // hash -> { context|null, at }

  function cacheGet(hash) {
    const hit = verifyCache.get(hash);
    if (!hit) return undefined;
    if (Date.now() - hit.at > VERIFY_TTL_MS) {
      verifyCache.delete(hash);
      return undefined;
    }
    return hit.context; // may be null (cached "not valid")
  }
  function cacheSet(hash, context) {
    verifyCache.set(hash, { context, at: Date.now() });
  }
  function cacheInvalidate(hash) {
    verifyCache.delete(hash);
  }

  // ── createApiKey ──────────────────────────────────────────────────
  async function createApiKey({ tenantId, name, role, createdBy }) {
    if (!tenantId)        throw httpError(400, 'tenantId is required');
    if (!name)            throw httpError(400, 'name is required');
    if (!role)            throw httpError(400, 'role is required');
    if (!createdBy)       throw httpError(400, 'createdBy is required');
    if (!['admin', 'planner', 'finance', 'viewer'].includes(role)) {
      throw httpError(400, `role must be one of admin, planner, finance, viewer (got '${role}')`);
    }

    const rawToken = generateRawToken();
    const row = await dbUpsert('api_keys', {
      tenant_id:  tenantId,
      name:       String(name).trim().slice(0, 120),
      key_prefix: prefixOf(rawToken),
      key_hash:   hashToken(rawToken),
      role,
      created_by: createdBy,
    });

    // Note: we deliberately do NOT cache the new key in verifyCache
    // here — the next call to verifyApiKey() will hit the DB and seed
    // it, which keeps the cache-set path single-sourced.
    return { row, rawToken };
  }

  // ── listApiKeysForTenant ──────────────────────────────────────────
  async function listApiKeysForTenant(tenantId) {
    if (!tenantId) throw httpError(400, 'tenantId is required');
    // The hash is intentionally NOT returned to the UI — there is no
    // legitimate UI reason to see it and it would be a needless
    // sensitive-data exposure.
    const rows = await dbSelect(
      'api_keys',
      `select=id,tenant_id,name,key_prefix,role,created_by,created_at,last_used_at,revoked_at,revoked_by`
      + `&tenant_id=eq.${encodeURIComponent(tenantId)}`
      + `&order=created_at.desc`,
    );
    return Array.isArray(rows) ? rows : [];
  }

  // ── revokeApiKey ──────────────────────────────────────────────────
  async function revokeApiKey({ id, revokedBy, tenantId }) {
    if (!id)        throw httpError(400, 'id is required');
    if (!revokedBy) throw httpError(400, 'revokedBy is required');

    // Look up the row first so we (a) confirm tenant scope, (b) get
    // the hash for cache invalidation, (c) can return a stable
    // already-revoked response instead of double-revoking.
    const rows = await dbSelect(
      'api_keys',
      `select=id,tenant_id,key_hash,revoked_at&id=eq.${encodeURIComponent(id)}&limit=1`,
    );
    const existing = rows && rows[0];
    if (!existing)                          throw httpError(404, 'API key not found');
    if (tenantId && existing.tenant_id !== tenantId) {
      // Defence in depth — the route guard already filters by tenant,
      // but a misconfigured caller shouldn't be able to revoke a
      // sibling tenant's key by guessing an id.
      throw httpError(403, 'Cannot revoke a key from another tenant');
    }
    if (existing.revoked_at) {
      cacheInvalidate(existing.key_hash);
      return existing; // idempotent
    }

    const updated = await dbUpdate('api_keys', id, {
      revoked_at: new Date().toISOString(),
      revoked_by: revokedBy,
    }, null);
    cacheInvalidate(existing.key_hash);
    return updated;
  }

  // ── verifyApiKey ──────────────────────────────────────────────────
  //
  // Returns either:
  //   • { id, role, tenantId, apiKeyId }  — synthetic user context
  //   • null                              — invalid / revoked / unknown
  //
  // Designed for the auth middleware fast-path: short-circuit on
  // cache hit, single indexed query on miss. The last_used_at bump
  // is fire-and-forget (we don't await it) so a flaky write doesn't
  // gate authentication.
  async function verifyApiKey(rawToken) {
    if (!rawToken || typeof rawToken !== 'string') return null;
    const hash = hashToken(rawToken);

    const cached = cacheGet(hash);
    if (cached !== undefined) return cached;

    let context = null;
    try {
      const rows = await dbSelect(
        'api_keys',
        `select=id,tenant_id,role,created_by,revoked_at&key_hash=eq.${encodeURIComponent(hash)}&limit=1`,
      );
      const row = rows && rows[0];
      if (row && !row.revoked_at) {
        context = {
          id:        row.created_by,    // surface the issuer's user id
          role:      row.role,
          tenantId:  row.tenant_id,
          apiKeyId:  row.id,
        };
        // Fire-and-forget last_used_at update.
        dbUpdate('api_keys', row.id, { last_used_at: new Date().toISOString() }, null)
          .catch((err) => console.warn('[apiKeys] last_used_at update failed:', err?.message || err));
      }
    } catch (err) {
      console.warn('[apiKeys] verifyApiKey lookup failed:', err?.message || err);
      // Fall through to cache null — a transient lookup failure
      // shouldn't pin us in a tight retry loop.
    }

    cacheSet(hash, context);
    return context;
  }

  return {
    createApiKey,
    listApiKeysForTenant,
    revokeApiKey,
    verifyApiKey,
    // Exposed for tests / instrumentation; not used by routes.
    _internal: { cacheInvalidate, hashToken, prefixOf, generateRawToken },
  };
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = {
  createApiKeysService,
  // Re-export the pure helpers for callers that don't want the full
  // service (e.g. one-off scripts, tests of the hash format).
  generateRawToken,
  hashToken,
};
