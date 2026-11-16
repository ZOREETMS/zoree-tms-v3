// ═══════════════════════════════════════════════════════════════════
// Email order agent routes — /api/email-intake/*
//
//   GET  /status            agent config + last run + counts
//   GET  /                  list intake rows (?status=pending_review|created|rejected|not_order|error|all)
//   GET  /:id               one row (with email body)
//   POST /poll              check the mailbox now
//   POST /paste             run the agent on a pasted email {from, subject, body}
//   POST /:id/approve       create orders {drafts?: edited drafts}
//   POST /:id/reject        {reason?}
//   POST /:id/retry         re-extract from the stored body
//
// Reads need a signed-in user. Anything that can create orders needs
// Edit on Orders in the role matrix — same gate as POST /api/orders.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const express = require('express');
const intake = require('../services/emailIntake/intakeService');
const poller = require('../services/emailIntake/poller');

function createEmailIntakeRouter({ verifyToken, getUserRole, canWriteTable, getTenantId }) {
  const router = express.Router();

  const send = (res, err) => {
    const status = err.status || 500;
    res.status(status).json({ error: err.message, ...(err.missing ? { missing: err.missing } : {}) });
  };

  async function requireOrderWrite(req, res) {
    const u = await verifyToken(req, res);
    if (!u) return null;
    if (!(await canWriteTable(u, 'orders', 'POST', getTenantId(u)))) {
      res.status(403).json({ error: `Role '${getUserRole(u)}' has no Edit access on Orders.` });
      return null;
    }
    return u;
  }

  router.get('/status', async (req, res) => {
    const u = await verifyToken(req, res); if (!u) return;
    try {
      let counts = null;
      let countsError = null;
      try { counts = await intake.statusCounts(); } catch (e) { countsError = e.message; }
      res.json({ ...poller.status(), counts, countsError });
    } catch (err) { send(res, err); }
  });

  router.get('/', async (req, res) => {
    const u = await verifyToken(req, res); if (!u) return;
    try { res.json(await intake.listIntake({ status: req.query.status || 'pending_review', limit: req.query.limit })); }
    catch (err) { send(res, err); }
  });

  router.post('/poll', async (req, res) => {
    const u = await requireOrderWrite(req, res); if (!u) return;
    try { res.json(await poller.runOnce()); } catch (err) { send(res, err); }
  });

  router.post('/paste', express.json({ limit: '1mb' }), async (req, res) => {
    const u = await requireOrderWrite(req, res); if (!u) return;
    try { res.status(201).json(await intake.processPastedEmail(req.body || {}, u)); }
    catch (err) { send(res, err); }
  });

  router.get('/:id', async (req, res) => {
    const u = await verifyToken(req, res); if (!u) return;
    try {
      const row = await intake.getIntake(req.params.id);
      if (!row) return res.status(404).json({ error: 'Not found' });
      res.json(row);
    } catch (err) { send(res, err); }
  });

  router.post('/:id/approve', express.json({ limit: '1mb' }), async (req, res) => {
    const u = await requireOrderWrite(req, res); if (!u) return;
    try { res.json(await intake.approveIntake(req.params.id, { drafts: req.body && req.body.drafts }, u)); }
    catch (err) { send(res, err); }
  });

  router.post('/:id/reject', async (req, res) => {
    const u = await requireOrderWrite(req, res); if (!u) return;
    try { res.json(await intake.rejectIntake(req.params.id, req.body && req.body.reason, u)); }
    catch (err) { send(res, err); }
  });

  router.post('/:id/retry', async (req, res) => {
    const u = await requireOrderWrite(req, res); if (!u) return;
    try { res.json(await intake.retryIntake(req.params.id)); }
    catch (err) { send(res, err); }
  });

  return router;
}

module.exports = { createEmailIntakeRouter };
