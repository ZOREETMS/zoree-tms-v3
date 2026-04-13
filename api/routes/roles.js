const express = require('express');

function createRolesRouter({ verifyToken, getTenantId, getUserRole, loadRolePermissions, saveRolePermissions, roleFeatures }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    const tenantId = getTenantId(user);
    const permissions = await loadRolePermissions(tenantId);
    res.json({
      features: permissions.features,
      featureKeys: permissions.featureKeys,
      roles: permissions.roles,
      roleMetadata: permissions.roleMetadata,
    });
  });

  router.patch('/:role', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (getUserRole(user) !== 'admin') {
      return res.status(403).json({ error: 'Admin role required' });
    }

    const roleKey = String(req.params.role || '').trim().toLowerCase();
    if (!roleKey) return res.status(400).json({ error: 'Role is required' });

    const incoming = req.body && req.body.permissions;
    if (!incoming || typeof incoming !== 'object') {
      return res.status(400).json({ error: 'permissions object is required' });
    }

    const tenantId = getTenantId(user);
    const current = await loadRolePermissions(tenantId);
    const featureKeys = current.featureKeys.length ? current.featureKeys : roleFeatures;
    const normalizedPermissions = Object.fromEntries(
      featureKeys.map((featureKey) => [featureKey, !!incoming[featureKey]])
    );

    const saved = await saveRolePermissions(roleKey, normalizedPermissions, tenantId);
    res.json({
      role: roleKey,
      permissions: saved.roles[roleKey] || normalizedPermissions,
      features: saved.features,
      featureKeys: saved.featureKeys,
      roles: saved.roles,
      roleMetadata: saved.roleMetadata,
    });
  });

  return router;
}

module.exports = { createRolesRouter };
