// ═══════════════════════════════════════════════════════════════════
// User Management Routes — REQ-08.
//
//   GET    /api/users                 — list users (admin only)
//   POST   /api/users                 — create user (admin only)
//   PATCH  /api/users/:id              — update user (admin only; full_name, roles, active_role, password, disabled)
//   DELETE /api/users/:id              — delete user (admin only)
//
//   PATCH  /api/auth/active-role       — authenticated user switches their own active_role
//
// The router is constructed with the shared dependencies because the
// server.js module owns verifyToken / getUserRole / SUPABASE_URL / etc.
// ═══════════════════════════════════════════════════════════════════

const router = require('express').Router();
const userMgmt = require('../services/userManagement');

module.exports = function createUsersRouter({ verifyToken, getUserRole, SUPABASE_URL, SERVICE_KEY, invalidateProfileCache }) {
  const invalidate = typeof invalidateProfileCache === 'function' ? invalidateProfileCache : () => {};
  function requireAdmin(req, res, user) {
    if (getUserRole(user) !== 'admin') {
      res.status(403).json({ error: `Role '${getUserRole(user)}' cannot manage users. Required: admin.` });
      return false;
    }
    return true;
  }

  router.get('/', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireAdmin(req, res, user)) return;
    try {
      const list = await userMgmt.listUsers({ supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY });
      res.json({ users: list, total: list.length });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  router.post('/', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireAdmin(req, res, user)) return;
    try {
      const { email, password, fullName, roles, activeRole } = req.body || {};
      const result = await userMgmt.createUser(
        { email, password, fullName, roles, activeRole },
        { supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY }
      );
      res.status(201).json(result);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  router.patch('/:id', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireAdmin(req, res, user)) return;
    try {
      const { roles, activeRole, fullName, disabled, password } = req.body || {};
      const updated = await userMgmt.updateUser(
        { userId: req.params.id, roles, activeRole, fullName, disabled, password },
        { supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY }
      );
      invalidate(req.params.id);
      res.json(updated);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  router.delete('/:id', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireAdmin(req, res, user)) return;
    try {
      // Guard: admin cannot delete themselves
      if (req.params.id === user.id) {
        return res.status(409).json({ error: 'Cannot delete your own account while signed in.' });
      }
      const result = await userMgmt.deleteUser(
        { userId: req.params.id },
        { supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY }
      );
      invalidate(req.params.id);
      res.json(result);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  return router;
};
