// ═══════════════════════════════════════════════════════════════════
// /api/domains (migration 052)
//   GET /mine → the domains the signed-in user can work in, and the one
//               this request resolved to.
// ═══════════════════════════════════════════════════════════════════
'use strict';

module.exports = function createDomainsRouter({ verifyToken }) {
  const router = require('express').Router();

  router.get('/mine', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    res.json({ active: req.domain, domains: req.domains || [] });
  });

  return router;
};
