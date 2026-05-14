// ════════════════════════════════════════════════════════════════════
// routes/apiKeys.js — REST surface for the api_keys table.
// QA bug #261c.
//
// Mounted at /api/api-keys from api/server.js. Admin-only on all
// mutating endpoints; list is also admin-only because a non-admin
// seeing other people's key prefixes leaks information.
//
// Endpoints:
//   GET    /api/api-keys              — list active + revoked keys for
//                                       the caller's tenant
//   POST   /api/api-keys              — create a new key; returns the
//                                       raw token ONCE in `rawToken`
//   DELETE /api/api-keys/:id          — soft-revoke a key
//
// Service layer (api/services/apiKeys.js) carries the actual logic;
// this file is a thin Express shell that does auth gating, request
// parsing, error mapping, and response shaping.
// ════════════════════════════════════════════════════════════════════

const express = require('express');

function createApiKeysRouter({
  verifyToken,
  getTenantId,
  getUserRole,
  apiKeysService,   // result of createApiKeysService(...)
}) {
  if (!verifyToken || !getTenantId || !getUserRole || !apiKeysService) {
    throw new Error('createApiKeysRouter: verifyToken, getTenantId, getUserRole, apiKeysService are all required');
  }

  const router = express.Router();

  // ── GET /api/api-keys ─────────────────────────────────────────────
  router.get('/', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (getUserRole(user) !== 'admin') {
      return res.status(403).json({ error: 'Admin role required' });
    }
    try {
      const tenantId = getTenantId(user);
      const keys = await apiKeysService.listApiKeysForTenant(tenantId);
      // Shape the response: never return key_hash. Add a synthetic
      // `status` field so the UI doesn't have to recompute it from
      // revoked_at on every render.
      const shaped = keys.map((k) => ({
        id:           k.id,
        name:         k.name,
        keyPrefix:    k.key_prefix,
        role:         k.role,
        createdBy:    k.created_by,
        createdAt:    k.created_at,
        lastUsedAt:   k.last_used_at,
        revokedAt:    k.revoked_at,
        revokedBy:    k.revoked_by,
        status:       k.revoked_at ? 'revoked' : 'active',
      }));
      res.json({ keys: shaped, total: shaped.length });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message || 'Failed to list API keys' });
    }
  });

  // ── POST /api/api-keys ────────────────────────────────────────────
  router.post('/', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (getUserRole(user) !== 'admin') {
      return res.status(403).json({ error: 'Admin role required' });
    }
    try {
      const { name, role } = req.body || {};
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'name is required' });
      }
      if (!role || typeof role !== 'string') {
        return res.status(400).json({ error: 'role is required' });
      }

      const tenantId = getTenantId(user);
      const { row, rawToken } = await apiKeysService.createApiKey({
        tenantId,
        name:      name.trim(),
        role:      role.toLowerCase(),
        createdBy: user.id,
      });

      // Return the raw token ONCE. After this response, the admin
      // cannot recover it — they must revoke and re-issue. The UI
      // surfaces a clear "save this now" prompt to match.
      res.status(201).json({
        rawToken,    // ⚠ show-once secret
        key: {
          id:        row.id,
          name:      row.name,
          keyPrefix: row.key_prefix,
          role:      row.role,
          createdBy: row.created_by,
          createdAt: row.created_at,
          status:    'active',
        },
      });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message || 'Failed to create API key' });
    }
  });

  // ── DELETE /api/api-keys/:id ──────────────────────────────────────
  router.delete('/:id', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (getUserRole(user) !== 'admin') {
      return res.status(403).json({ error: 'Admin role required' });
    }
    try {
      const tenantId = getTenantId(user);
      const updated = await apiKeysService.revokeApiKey({
        id:        req.params.id,
        revokedBy: user.id,
        tenantId,
      });
      res.json({
        ok:        true,
        id:        updated.id,
        revokedAt: updated.revoked_at,
        revokedBy: updated.revoked_by,
      });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message || 'Failed to revoke API key' });
    }
  });

  return router;
}

module.exports = { createApiKeysRouter };
