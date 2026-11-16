'use strict';
// People decide the hard cases. The agent only recommends.
const express = require('express');
const runStore = require('../services/runStore');
const explainer = require('../services/explainer');

const router = express.Router();
const ACTIONS = new Set(['approve', 'short_pay', 'reject', 'request_docs', 'hold']);

// POST /api/decisions/:seq { action, note, by, amount }
router.post('/:seq', async (req, res) => {
  const job = runStore.getJob();
  if (!job || job.status !== 'done') return res.status(409).json({ error: 'Finish a run first' });
  const seq = Number(req.params.seq);
  const r = job.results.find((x) => x.invoice.seq === seq);
  if (!r) return res.status(404).json({ error: 'Unknown invoice' });
  const { action, note, by, amount } = req.body || {};
  if (!ACTIONS.has(action)) return res.status(400).json({ error: `action must be one of ${[...ACTIONS].join(', ')}` });
  const decision = { action, note: note || '', by: by || 'AP clerk', amount: amount != null ? Number(amount) : undefined };
  if (action === 'short_pay') decision.draft = await explainer.draftDispute(r, { preferCache: job.offline });
  res.json(runStore.recordDecision(seq, decision));
});

router.get('/', (req, res) => res.json(runStore.getDecisions()));

module.exports = router;
