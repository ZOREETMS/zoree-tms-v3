// ═══════════════════════════════════════════════════════════════════
// Quantum Engine Routes — /api/quantum/*
// ─────────────────────────────────────────────────────────────────────
// Zoree ↔ Otodus Quantum. Two kinds of endpoint:
//
// Planning (the app's entry point — uses Zoree's own data):
//   GET  /api/quantum/status             — configured? reachable?
//   POST /api/quantum/plan/consolidate   — orders → engine → capacity-checked groups
//   POST /api/quantum/plan/rates         — orders → engine carrier assignment
//        body: { orderIds?: string[], limit?: number,
//                densityLbPerCuft?: number, allow?: string[], dryRun?: boolean,
//                engine?: 'zoree' | 'otodus',   default QUANTUM_ENGINE_MODE or 'zoree'
//                seed?: number,                 zoree: reproducible plan
//                exportQubo?: boolean,          zoree: include each bucket's BQM
//                sampler?: 'local' | 'sb' | 'exact' | 'dwave-hybrid' | 'dwave-qpu' | 'dwave-sa',
//                dwaveTimeLimit?: number,       seconds, Leap hybrid only
//                optimalityGap?: boolean }      zoree: also report the gap to the proven optimum
//        sampler 'local' = simulated annealing, 'sb' = simulated bifurcation
//        (quantum-inspired), 'exact' = proven optimum over the candidate loads;
//        all three run in-process with no extra install.
//        sampler 'dwave-*' sends the QUBO to D-Wave (needs DWAVE_API_TOKEN
//        and Python with dwave-ocean-sdk — see services/quantumLocal/dwaveSampler.js).
//        D-Wave calls spend paid solver time.
//   GET  /api/quantum/status?dwave=1     — also checks D-Wave readiness (no solver time)
//        status in the response: 'ok' | 'dry_run' | 'blocked' (422)
//        Nothing is written to the database — results are proposals.
//
// Engines: 'zoree' is Zoree's own QUBO optimizer (services/quantumLocal),
// in-process, no license spend. 'otodus' is the vendor container.
//
// Raw passthrough (caller supplies an engine-shaped body):
//   GET  /api/quantum/health             — engine liveness (no license key used)
//   POST /api/quantum/optimize/rates
//   POST /api/quantum/optimize/consolidate
//   POST /api/quantum/predict/eta        { distance_miles, weather, traffic, carrier_id }
//   POST /api/quantum/reroute            { origin_city, destination_city, avoid_disruptions? }
//
// Everything except /health requires a signed-in user (or ApiKey): Otodus
// calls spend the vendor license and Zoree planning reads tenant freight,
// so neither may be open to anyone who can reach the API. The raw
// passthrough endpoints are Otodus-only.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const express = require('express');
const quantumEngine = require('../services/quantumEngine');
const quantumPlanning = require('../services/quantumPlanning');

function createQuantumEngineRouter({ verifyToken }) {
  if (typeof verifyToken !== 'function') throw new Error('createQuantumEngineRouter requires verifyToken');
  const router = express.Router();

  function sendError(res, next, err) {
    if (err.status) return res.status(err.status).json({ error: err.message, data: err.data });
    next(err);
  }

  // Wraps a handler with auth; verifyToken writes the 401 itself.
  const authed = (handler) => async (req, res, next) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    try { await handler(req, res, user); } catch (err) { sendError(res, next, err); }
  };

  // ── Planning ─────────────────────────────────────────────────────
  router.get('/status', authed(async (req, res) => {
    res.json(await quantumPlanning.status({ dwave: req.query.dwave === '1' || req.query.dwave === 'true' }));
  }));

  const planHandler = (task) => authed(async (req, res) => {
    const result = await quantumPlanning.plan({ ...(req.body || {}), task }, req.tenant || null);
    res.status(result.status === 'blocked' ? 422 : 200).json(result);
  });
  router.post('/plan/consolidate', planHandler('consolidate'));
  router.post('/plan/rates', planHandler('rates'));

  // ── Raw passthrough ──────────────────────────────────────────────
  router.get('/health', async (_req, res, next) => {
    try { res.json(await quantumEngine.checkHealth()); } catch (err) { sendError(res, next, err); }
  });
  router.post('/optimize/rates', authed(async (req, res) => {
    res.json(await quantumEngine.optimizeRates(req.body));
  }));
  router.post('/optimize/consolidate', authed(async (req, res) => {
    res.json(await quantumEngine.optimizeConsolidate(req.body));
  }));
  router.post('/predict/eta', authed(async (req, res) => {
    res.json(await quantumEngine.predictEta(req.body));
  }));
  router.post('/reroute', authed(async (req, res) => {
    res.json(await quantumEngine.reroute(req.body));
  }));

  return router;
}

module.exports = { createQuantumEngineRouter };
