// ═══════════════════════════════════════════════════════════════════
// AI agent routes — /api/agents/*
//
//   GET  /                        catalog + policy tiers + pending counts + config flags
//   GET  /runs?agent=&limit=      recent runs with their actions
//   GET  /runs/:id                one run with actions
//   POST /:agent/run              run an agent { ...input }
//   POST /actions/:id/approve     { edits? } → executes through the owning service
//   POST /actions/:id/reject      { reason? }
//
// Running an agent only proposes actions, so a signed-in user may run
// one. Approving needs Edit on the table the action changes (role
// matrix), the same gate as the equivalent UI action.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const express = require('express');
const runner = require('../services/agents');
const store = require('../services/agents/agentRunStore');
const { AGENTS, ACTION_TYPES } = require('../services/agents/agentCatalog');
const { policySnapshot } = require('../services/agents/agentPolicies');
const { isConfigured: llmConfigured } = require('../services/agents/llm/claudeTool');
const { shouldEmail } = require('../services/agents/outbound/outboundMessage');

function createAgentsRouter({ verifyToken, getUserRole, canWriteTable, getTenantId }) {
  const router = express.Router();
  const send = (res, err) => res.status(err.status || 500).json({ error: err.message });

  async function requireActionWrite(req, res) {
    const u = await verifyToken(req, res);
    if (!u) return null;
    const action = await store.getAction(req.params.id);
    if (!action) { res.status(404).json({ error: 'Action not found' }); return null; }
    const table = (ACTION_TYPES[action.action_type] || {}).table;
    if (!(await canWriteTable(u, table, 'PATCH', getTenantId(u)))) {
      res.status(403).json({ error: `Role '${getUserRole(u)}' has no Edit access on ${table}.` });
      return null;
    }
    return u;
  }

  router.get('/', async (req, res) => {
    const u = await verifyToken(req, res); if (!u) return;
    try {
      res.json({
        agents: Object.values(AGENTS),
        actionTypes: ACTION_TYPES,
        policy: policySnapshot(),
        pending: await store.pendingCounts(),
        config: { llmConfigured: llmConfigured(), emailSending: shouldEmail() },
      });
    } catch (err) { send(res, err); }
  });

  router.get('/runs', async (req, res) => {
    const u = await verifyToken(req, res); if (!u) return;
    try { res.json(await store.listRuns({ agent: req.query.agent || null, limit: req.query.limit })); }
    catch (err) { send(res, err); }
  });

  router.get('/runs/:id', async (req, res) => {
    const u = await verifyToken(req, res); if (!u) return;
    try {
      const run = await store.getRun(req.params.id);
      if (!run) return res.status(404).json({ error: 'Run not found' });
      res.json(run);
    } catch (err) { send(res, err); }
  });

  router.post('/:agent/run', express.json({ limit: '12mb' }), async (req, res) => {
    const u = await verifyToken(req, res); if (!u) return;
    try { res.status(201).json(await runner.runAgent(req.params.agent, req.body || {}, { user: u, trigger: 'manual' })); }
    catch (err) { send(res, err); }
  });

  router.post('/actions/:id/approve', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const u = await requireActionWrite(req, res); if (!u) return;
      res.json(await runner.approveAction(req.params.id, { user: u, edits: req.body && req.body.edits }));
    } catch (err) { send(res, err); }
  });

  router.post('/actions/:id/reject', express.json(), async (req, res) => {
    try {
      const u = await requireActionWrite(req, res); if (!u) return;
      res.json(await runner.rejectAction(req.params.id, { user: u, reason: req.body && req.body.reason }));
    } catch (err) { send(res, err); }
  });

  return router;
}

module.exports = { createAgentsRouter };
