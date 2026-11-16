'use strict';
const express = require('express');
const config = require('../config');
const dataPack = require('../services/dataPack');
const pipeline = require('../services/agentPipeline');
const runStore = require('../services/runStore');
const explainer = require('../services/explainer');

const router = express.Router();

// POST /api/audit/run { offline? } — start the agent on the AP inbox
router.post('/run', (req, res) => {
  const current = runStore.getJob();
  if (current && current.status === 'running') return res.status(409).json({ error: 'A run is already in progress' });
  const offline = Boolean(req.body && req.body.offline);
  const job = runStore.newJob(config.agentMode, { offline });
  pipeline.run(job, { offline })
    .then(() => runStore.finishJob(job))
    .catch((e) => runStore.finishJob(job, e));
  res.status(202).json({ id: job.id });
});

// GET /api/audit/run — progress and results so far
router.get('/run', (req, res) => {
  const job = runStore.getJob();
  if (!job) return res.status(404).json({ error: 'No run yet' });
  res.json(publicJob(job));
});

// GET /api/audit/explain/:seq — plain-English explanation for one invoice
router.get('/explain/:seq', async (req, res) => {
  const r = findResult(req.params.seq);
  if (!r) return res.status(404).json({ error: 'Unknown invoice' });
  if (!r.explanation) r.explanation = await explainer.explain(r, { preferCache: runStore.getJob().offline });
  res.json(r.explanation);
});

// POST /api/audit/ask { question }
router.post('/ask', async (req, res) => {
  const question = String((req.body && req.body.question) || '').trim();
  if (!question) return res.status(400).json({ error: 'question required' });
  const out = await explainer.answer(question, runStore.getJob(), dataPack.load().policy);
  runStore.log('question', { question, source: out.source });
  res.json(out);
});

router.get('/log', (req, res) => res.json(runStore.getLog()));

function findResult(seq) {
  const job = runStore.getJob();
  return job && job.results.find((r) => r.invoice.seq === Number(seq));
}

function publicJob(job) {
  return {
    id: job.id, mode: job.mode, status: job.status, error: job.error, startedAt: job.startedAt, finishedAt: job.finishedAt,
    offline: job.offline, total: job.total, events: job.events.slice(-40), summary: job.summary, checks: job.checks,
    model: explainer.available() ? config.anthropic.model : null,
    results: job.results.map((r) => ({
      seq: r.invoice.seq, invoice: r.invoice, shipment: r.shipment || null, contract: r.contract || null, expected: r.expected || null,
      verdict: r.verdict, route: r.route, issues: r.issues, passed: r.passed, recommendation: r.recommendation,
      overcharge: r.overcharge, held: r.held, recommendPay: r.recommendPay, read: r.read,
    })),
  };
}

module.exports = router;
