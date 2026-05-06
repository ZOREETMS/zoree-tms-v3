// ════════════════════════════════════════════════════════════════════
// /api/roles router
//
//   GET    /                    — load full role × feature matrix
//   POST   /                    — create a new role (admin only)
//   PATCH  /:role               — replace a role's access_level map
//   DELETE /:role               — delete a custom (non-system) role
//
// Admin role is locked: PATCH and DELETE on 'admin' are rejected before
// the service layer is called. Service layer enforces the same rule
// defensively.
// ════════════════════════════════════════════════════════════════════

const express = require('express');

const ACCESS_LEVELS = ['edit', 'view', 'none'];

function createRolesRouter({
  verifyToken,
  getTenantId,
  getUserRole,
  loadRolePermissions,
  saveRolePermissions,
  createRole,
  deleteRole,
}) {
  const router = express.Router();

  // ── GET /api/roles ────────────────────────────────────────────────
  router.get('/', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    try {
      const tenantId = getTenantId(user);
      const permissions = await loadRolePermissions(tenantId);
      res.json({
        features: permissions.features,
        featureKeys: permissions.featureKeys,
        roles: permissions.roles,
        roleMetadata: permissions.roleMetadata,
      });
    } catch (e) {
      res.status(500).json({ error: e.message || 'Failed to load roles' });
    }
  });

  // ── POST /api/roles ───────────────────────────────────────────────
  router.post('/', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (getUserRole(user) !== 'admin') {
      return res.status(403).json({ error: 'Admin role required' });
    }
    if (typeof createRole !== 'function') {
      return res.status(501).json({ error: 'Role creation is not enabled on this server' });
    }

    const { role_key, roleKey, display_name, displayName, description, default_level, defaultLevel } = req.body || {};
    const finalKey   = roleKey || role_key;
    const finalLabel = displayName || display_name;
    const finalDesc  = description;
    const finalLevel = defaultLevel || default_level || 'view';

    if (!finalKey || typeof finalKey !== 'string') {
      return res.status(400).json({ error: 'roleKey is required' });
    }
    if (!ACCESS_LEVELS.includes(String(finalLevel).toLowerCase())) {
      return res.status(400).json({ error: `defaultLevel must be one of ${ACCESS_LEVELS.join(', ')}` });
    }

    try {
      const tenantId = getTenantId(user);
      const saved = await createRole(
        { roleKey: finalKey, displayName: finalLabel, description: finalDesc, defaultLevel: finalLevel },
        tenantId,
      );
      res.status(201).json({
        role: String(finalKey).trim().toLowerCase(),
        features: saved.features,
        featureKeys: saved.featureKeys,
        roles: saved.roles,
        roleMetadata: saved.roleMetadata,
      });
    } catch (e) {
      const msg = e.message || 'Failed to create role';
      const code = /already exists/i.test(msg) ? 409 : 400;
      res.status(code).json({ error: msg });
    }
  });

  // ── PATCH /api/roles/:role ────────────────────────────────────────
  router.patch('/:role', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (getUserRole(user) !== 'admin') {
      return res.status(403).json({ error: 'Admin role required' });
    }

    const roleKey = String(req.params.role || '').trim().toLowerCase();
    if (!roleKey) return res.status(400).json({ error: 'Role is required' });
    if (roleKey === 'admin') {
      return res.status(403).json({ error: 'Admin role permissions are locked' });
    }

    const incoming = req.body && req.body.permissions;
    if (!incoming || typeof incoming !== 'object') {
      return res.status(400).json({ error: 'permissions object is required' });
    }

    // Validate every level value before touching the DB.
    const invalid = Object.entries(incoming).filter(([, v]) => !ACCESS_LEVELS.includes(String(v).toLowerCase()));
    if (invalid.length) {
      return res.status(400).json({
        error: `Invalid access_level values: ${invalid.map(([k]) => k).join(', ')}. Use ${ACCESS_LEVELS.join(', ')}.`,
      });
    }

    try {
      const tenantId = getTenantId(user);
      const current = await loadRolePermissions(tenantId);
      const featureKeys = current.featureKeys;

      // Normalize: every feature must have a level (default 'none' if omitted).
      const normalized = Object.fromEntries(
        featureKeys.map((featureKey) => [featureKey, String(incoming[featureKey] || 'none').toLowerCase()]),
      );

      const saved = await saveRolePermissions(roleKey, normalized, tenantId);
      res.json({
        role: roleKey,
        permissions: saved.roles[roleKey] || normalized,
        features: saved.features,
        featureKeys: saved.featureKeys,
        roles: saved.roles,
        roleMetadata: saved.roleMetadata,
      });
    } catch (e) {
      res.status(400).json({ error: e.message || 'Failed to save role permissions' });
    }
  });

  // ── DELETE /api/roles/:role ───────────────────────────────────────
  router.delete('/:role', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (getUserRole(user) !== 'admin') {
      return res.status(403).json({ error: 'Admin role required' });
    }
    if (typeof deleteRole !== 'function') {
      return res.status(501).json({ error: 'Role deletion is not enabled on this server' });
    }

    const roleKey = String(req.params.role || '').trim().toLowerCase();
    if (!roleKey) return res.status(400).json({ error: 'Role is required' });
    if (roleKey === 'admin') {
      return res.status(403).json({ error: 'Admin role cannot be deleted' });
    }

    try {
      const tenantId = getTenantId(user);
      const saved = await deleteRole(roleKey, tenantId);
      res.json({
        role: roleKey,
        deleted: true,
        features: saved.features,
        featureKeys: saved.featureKeys,
        roles: saved.roles,
        roleMetadata: saved.roleMetadata,
      });
    } catch (e) {
      const msg = e.message || 'Failed to delete role';
      const code = /system role/i.test(msg) ? 403 : 400;
      res.status(code).json({ error: msg });
    }
  });

  return router;
}

module.exports = { createRolesRouter };
