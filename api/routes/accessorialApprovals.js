// ═══════════════════════════════════════════════════════════════════
// /api/shipments/:shipmentId/accessorial-approvals  (migration 051)
// Approved extras on a shipment — what Freight Audit checks carrier
// liftgate / detention / lumper charges against.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const approvals = require('../services/accessorialApprovals');

module.exports = function createAccessorialApprovalsRouter({ verifyToken, hasAnyRole }) {
  const router = require('express').Router({ mergeParams: true });

  function allow(res, user, roles) {
    if (hasAnyRole(user, ...roles)) return true;
    res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
    return false;
  }

  router.get('/', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!allow(res, user, ['admin', 'planner', 'dispatcher', 'finance'])) return;
    try {
      const rows = await approvals.listForShipments([req.params.shipmentId]);
      res.json({ approvals: rows, types: approvals.TYPES });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  router.post('/', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!allow(res, user, ['admin', 'planner', 'dispatcher'])) return;
    try {
      const row = await approvals.create({ shipmentId: req.params.shipmentId, input: req.body || {}, user });
      res.status(201).json(row);
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  router.delete('/:approvalId', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!allow(res, user, ['admin', 'planner', 'dispatcher'])) return;
    try {
      res.json(await approvals.remove({ shipmentId: req.params.shipmentId, approvalId: req.params.approvalId, user }));
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  return router;
};
