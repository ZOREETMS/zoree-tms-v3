// ═══════════════════════════════════════════════════════════════════
// Zoree Quantum Engine (local) — api/services/quantumLocal/index.js
// ─────────────────────────────────────────────────────────────────────
// Zoree-owned replacement for the Otodus container, with the SAME
// interface as services/quantumEngine.js:
//
//   checkHealth()                       → { status, engine, version }
//   optimizeConsolidate(payload, ctx?)  → { groups:[…], unconsolidated, benchmark, solver }
//   optimizeRates(payload, ctx?)        → { assignments:[…], unpriced }
//
// so services/quantumPlanning.js can switch engines by name without any
// change to preflight, mapping or capacity re-validation. Runs in-process:
// no container, no license key, no network, no arch dependency, and the
// source is ours.
//
// `ctx` is optional and ignored by the Otodus client:
//   windows      { [shipmentId]: { ready, due } }  absolute service windows
//   seed         integer, makes the plan reproducible
//   exportQubo   include each bucket's QUBO as a dimod-loadable BQM, for
//                scripts/quantum/solve_bqm_dwave.py (real quantum hardware)
//   config       costModel overrides (maxPickups, maxDetourRatio, avgMph…)
//   solver       consolidation overrides (reads, sweeps, maxBucket, timeLimitMs…)
//   sampler      'local' (default, in-process simulated annealing) | 'sb'
//                (simulated bifurcation, quantum-inspired, in-process) |
//                'exact' (proven optimum over the candidate loads) | 'dwave-hybrid'
//                (Leap hybrid, one call per run) | 'dwave-qpu' (annealing QPU,
//                per bucket) | 'dwave-sa' (Ocean's local SA — tests the D-Wave
//                bridge without a token). See dwaveSampler.js for setup.
//   dwaveParams  passed to D-Wave: { time_limit, num_reads, solver }
//   optimalityGap  true → also solve each bucket exactly and report how far
//                the kept plan is from the proven pool optimum
//
// Every group returned has been priced and capacity/time-checked by
// costModel.evaluateLoad. quantumPlanning still re-validates caps on top
// (defence in depth — the rule from the Otodus integration stands).
// ═══════════════════════════════════════════════════════════════════

'use strict';

const { createCostModel } = require('./costModel');
const { consolidate, DEFAULTS: SOLVER_DEFAULTS } = require('./consolidation');
const dwaveSampler = require('./dwaveSampler');

const SAMPLERS = Object.freeze(['local', 'sb', 'exact', 'dwave-hybrid', 'dwave-qpu', 'dwave-sa']);

const SAMPLER_LABELS = Object.freeze({
  local: 'simulated annealing (QUBO), in-process',
  sb: 'simulated bifurcation (quantum-inspired, QUBO), in-process',
  exact: 'exact branch and bound (proven optimum over candidate loads), in-process',
  'dwave-hybrid': 'D-Wave Leap hybrid solver (quantum-classical)',
  'dwave-qpu': 'D-Wave annealing QPU (quantum annealing)',
  'dwave-sa': 'D-Wave Ocean simulated annealing (local, bridge test)',
});

const ENGINE = 'zoree-qubo';
const VERSION = '1.1.0';

const round2 = (n) => Math.round(n * 100) / 100;

function badPayload(msg) {
  return Object.assign(new Error(`zoree quantum engine: ${msg}`), { status: 400 });
}

function checkPayload(payload) {
  if (!payload || !Array.isArray(payload.shipments)) throw badPayload('payload.shipments must be an array');
  if (!Array.isArray(payload.carriers)) throw badPayload('payload.carriers must be an array');
}

async function checkHealth() {
  return { status: 'ok', engine: ENGINE, version: VERSION, runtime: `node ${process.version}`, in_process: true, samplers: SAMPLERS };
}

/** D-Wave readiness (Python, Ocean, token valid). Uses no solver time. */
function checkDwave() {
  return dwaveSampler.check();
}

/**
 * Plan-level optimality gap, when exact.js ran (optimalityGap or the exact
 * sampler). pool_optimum is the proven best over the candidate loads; a
 * negative gap means polish found loads outside the pool and beat it.
 */
function optimalitySummary(stats, groups) {
  const solved = stats.filter((s) => s.pool_optimum !== undefined);
  if (!solved.length) return undefined;
  const pool = solved.reduce((t, s) => t + s.pool_optimum, 0);
  const chosen = groups.reduce((t, g) => t + g.savings, 0);
  return {
    pool_optimum_savings: round2(pool),
    chosen_savings: round2(chosen),
    gap_pct: pool > 0 ? round2(((pool - chosen) / pool) * 100) : 0,
    buckets_proven: solved.filter((s) => s.optimum_proven).length,
    buckets_solved: solved.length,
  };
}

async function optimizeConsolidate(payload, ctx = {}) {
  checkPayload(payload);
  const t0 = Date.now();
  const model = createCostModel(payload, { windows: ctx.windows, config: ctx.config });
  const sampler = ctx.sampler || 'local';
  if (!SAMPLERS.includes(sampler)) throw badPayload(`sampler must be one of ${SAMPLERS.join(', ')}`);
  const solverOpts = {
    ...(ctx.solver || {}), exportQubo: ctx.exportQubo === true, sampler, dwaveParams: ctx.dwaveParams,
    ...(ctx.optimalityGap === true ? { optimalityGap: true } : {}),
  };
  if (Number.isInteger(ctx.seed)) solverOpts.seed = ctx.seed;
  const r = await consolidate(model, solverOpts);

  const grouped = new Set();
  const groups = r.groups.map((g, i) => {
    const ev = r.evaluate(g.ids);
    g.ids.forEach((id) => grouped.add(id));
    return {
      group_id: `ZQ-${String(i + 1).padStart(4, '0')}`,
      bucket: g.key,
      method: g.method,
      carrier_id: ev.carrier_id,
      shipment_ids: ev.ids,
      combined_weight_lbs: round2(ev.weight),
      combined_volume_cuft: round2(ev.volume),
      route_miles: round2(ev.route_miles),
      stops: ev.sequence,
      standalone_cost: round2(ev.standaloneCost),
      load_cost: round2(ev.cost),
      savings: round2(ev.savings),
    };
  });

  const qSum = r.stats.reduce((t, s) => t + (s.qubo_savings || 0), 0);
  const gSum = r.stats.reduce((t, s) => t + (s.greedy_savings || 0), 0);

  return {
    engine: ENGINE,
    version: VERSION,
    groups,
    unconsolidated: model.ids.filter((id) => !grouped.has(id) && !r.unpriced.includes(id)),
    unpriced: r.unpriced,
    benchmark: {
      // Per bucket the better plan is kept; these are the two totals side by side.
      qubo_savings: round2(qSum),
      greedy_savings: round2(gSum),
      chosen_savings: round2(groups.reduce((t, g) => t + g.savings, 0)),
      buckets_won_by_qubo: r.stats.filter((s) => s.winner === 'qubo').length,
      buckets_won_by_greedy: r.stats.filter((s) => s.winner === 'greedy').length,
      optimality: optimalitySummary(r.stats, groups),
    },
    solver: {
      type: SAMPLER_LABELS[sampler],
      sampler,
      dwave: r.dwave || undefined,
      sampling_ms: r.timing_ms.sampling,
      seed: solverOpts.seed ?? SOLVER_DEFAULTS.seed,
      time_windows: model.hasWindows ? 'absolute ready/due' : 'sla_hours only',
      buckets: r.stats,
      elapsed_ms: Date.now() - t0,
    },
    qubos: solverOpts.exportQubo ? r.qubos : undefined,
  };
}

/**
 * Cheapest standalone carrier per shipment (truckload or rated lane).
 * Purely classical — there is nothing combinatorial in picking a minimum.
 */
async function optimizeRates(payload, ctx = {}) {
  checkPayload(payload);
  const model = createCostModel(payload, { windows: ctx.windows, config: ctx.config });
  const assignments = [];
  const unpriced = [];
  for (const id of model.ids) {
    const q = model.standalone(id);
    if (!q) { unpriced.push(id); continue; }
    assignments.push({ shipment_id: id, carrier_id: q.carrier_id, mode: q.mode, cost: round2(q.cost) });
  }
  return { engine: ENGINE, version: VERSION, assignments, unpriced };
}

module.exports = {
  name: 'zoree',
  baseUrl: 'in-process',
  checkHealth,
  optimizeConsolidate,
  optimizeRates,
  checkDwave,
  SAMPLERS,
  ENGINE,
  VERSION,
};
