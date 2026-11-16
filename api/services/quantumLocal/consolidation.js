// ═══════════════════════════════════════════════════════════════════
// QUBO Load Consolidation — api/services/quantumLocal/consolidation.js
// ─────────────────────────────────────────────────────────────────────
// Hybrid quantum-classical consolidation, the same shape D-Wave's hybrid
// solvers use: classical decomposition → QUBO per sub-problem → quantum
// (or quantum-inspired) sampling → classical repair and polish.
//
// 1. Decompose. Shipments are bucketed by region lane and, within a lane,
//    by ready time into chunks of ≤ maxBucket. A truck cannot sensibly mix
//    Chicago→Detroit with Atlanta→Miami, so the QUBO never has to learn it.
//
// 2. Formulate — multilevel max-weight matching. Start with every
//    shipment as its own load. At each level, build a QUBO over every
//    feasible, profitable merge of two current loads:
//
//      y[a,b] = 1   merge load a with load b
//      E(y)   = − Σ g_ab · y[a,b]                       exact merge gain
//               + P · Σ y[a,b] · y[a,c]   (shared load)  a load merges at most once
//
//    g_ab comes from costModel, so capacity, stops, detour and service
//    time are enforced EXACTLY by which variables exist — no slack bits,
//    no approximation of multi-stop cost. Level 1 builds pairs, level 2
//    pairs-of-pairs and pair+single, and so on until nothing pays.
//
//    Why not the textbook assignment QUBO (x[i,truck] + slack-encoded
//    capacity)? It was built and measured first: on a 40-shipment batch
//    the annealer never reached a feasible state (best energy +64,013),
//    and summing pairwise savings over-rewards large groups. The matching
//    form has small, uniform coefficients and no hard equality
//    constraints, which is the structure annealers handle well.
//
// 3. Sample. One of: annealer.js (simulated annealing), bifurcation.js
//    (simulated bifurcation, quantum-inspired), exact.js (proven optimum
//    over the candidate loads), or D-Wave hardware via dwaveSampler.js.
//
// 4. Repair and polish — exactly. Every load is re-priced by
//    costModel.evaluateLoad; a local search then inserts solos and moves
//    members between loads while the exact savings improve.
//
// 5. Benchmark. A classical greedy merge (savings-based, Clarke–Wright
//    style) runs on the same bucket with the same polish. Each bucket
//    keeps whichever plan saves more and records both numbers, so the
//    quantum path has to earn its place on every run.
//
// 6. Optimality gap (opt-in, optimalityGap: true; always on for the exact
//    sampler). exact.js solves each bucket's candidate pool to proven
//    optimality and the stats report how far the kept plan is from it.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const { Qubo } = require('./qubo');
const { anneal } = require('./annealer');
const { bifurcate } = require('./bifurcation');
const { solvePacking } = require('./exact');

const DEFAULTS = Object.freeze({
  maxBucket: 24,
  maxColumnSize: 6,     // largest candidate load (shipments)
  beamWidth: 60,        // loads of size s grown into size s+1
  columnsPerShipment: 40,
  reads: 16,
  sweeps: 1000,
  timeLimitMs: 20000,  // whole batch
  seed: 1,
  polishRounds: 4,
  sbAgents: 32,         // simulated bifurcation: independent oscillator networks
  sbSteps: 1500,        //   integration steps per agent (stops early once settled)
  sbMode: 'discrete',   //   'discrete' (dSB, accurate) | 'ballistic' (bSB, fast)
  exactTimeLimitMs: 2000, // exact.js per bucket; plan is "best found" past this
  optimalityGap: false, // run exact.js per bucket and report the gap
});

// ── decomposition ───────────────────────────────────────────────────

function bucketize(model, ids, maxBucket) {
  const lanes = new Map();
  for (const id of ids) {
    const r = model.record(id);
    if (!lanes.has(r.lane)) lanes.set(r.lane, []);
    lanes.get(r.lane).push(r);
  }
  const buckets = [];
  for (const [lane, recs] of [...lanes.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    recs.sort((a, b) => (a.ready ?? 0) - (b.ready ?? 0) || a.id.localeCompare(b.id));
    for (let i = 0; i < recs.length; i += maxBucket) {
      buckets.push({ key: `${lane}#${i / maxBucket}`, ids: recs.slice(i, i + maxBucket).map((r) => r.id) });
    }
  }
  return buckets;
}

// ── exact evaluation, memoised per batch ─────────────────────────────

function memoEvaluator(model) {
  const cache = new Map();
  return function evaluate(ids) {
    const key = [...ids].sort().join('\u0001');
    if (!cache.has(key)) cache.set(key, model.evaluateLoad([...ids].sort()));
    return cache.get(key);
  };
}

/** Total savings of a plan: list of id-arrays (singletons save 0). */
function planSavings(groups, evaluate) {
  let t = 0;
  for (const g of groups) if (g.length > 1) t += evaluate(g).savings;
  return t;
}

const goodLoad = (ev) => ev.feasible && ev.savings > 1e-6;

// ── column pool: candidate loads ────────────────────────────────────

const keyOf = (ids) => [...ids].sort().join('\u0001');

/**
 * Candidate loads (columns) for the set-packing QUBO: every feasible,
 * profitable pair; beam-grown triples, quads… from the best loads of the
 * previous size; plus any seed loads (the greedy plan). Each shipment keeps
 * only its top-K columns so the QUBO stays sparse.
 */
function buildColumnPool(ids, evaluate, opts, seeds = []) {
  const cols = new Map(); // key → { ids, savings }
  const add = (g) => {
    const k = keyOf(g);
    if (cols.has(k)) return cols.get(k);
    const ev = evaluate(g);
    if (!goodLoad(ev)) return null;
    const c = { ids: [...g].sort(), savings: ev.savings };
    cols.set(k, c);
    return c;
  };

  let layer = [];
  for (let a = 0; a < ids.length; a++) {
    for (let b = a + 1; b < ids.length; b++) {
      const c = add([ids[a], ids[b]]);
      if (c) layer.push(c);
    }
  }
  for (let size = 3; size <= opts.maxColumnSize && layer.length; size++) {
    const beam = layer.sort((x, y) => y.savings - x.savings).slice(0, opts.beamWidth);
    const next = new Map();
    for (const c of beam) {
      const inC = new Set(c.ids);
      for (const id of ids) {
        if (inC.has(id)) continue;
        const g = [...c.ids, id];
        const k = keyOf(g);
        if (next.has(k)) continue;
        const col = add(g);
        if (col && col.savings > c.savings) next.set(k, col);
      }
    }
    layer = [...next.values()];
  }

  // Keep each shipment's top-K columns; seeds always stay.
  const keep = new Set(seeds.map((g) => keyOf(g)));
  for (const g of seeds) add(g);
  const byShip = new Map();
  for (const [k, c] of cols) for (const id of c.ids) {
    if (!byShip.has(id)) byShip.set(id, []);
    byShip.get(id).push([k, c.savings]);
  }
  for (const list of byShip.values()) {
    list.sort((x, y) => y[1] - x[1]).slice(0, opts.columnsPerShipment).forEach(([k]) => keep.add(k));
  }
  return [...keep].map((k) => cols.get(k)).filter(Boolean);
}

// ── QUBO construction: set packing ──────────────────────────────────

/**
 *   z[c] = 1  run candidate load c
 *
 *   E(z) = − Σ_c S_c · z[c]  +  P · Σ_{c,d share a shipment} z[c] · z[d]
 *
 * S_c is the exact savings of load c (costModel), so capacity, stops,
 * detour and service time are enforced by which columns exist. With
 * P > max S_c, any state that books a shipment twice is improved by a
 * single flip, so every local minimum is a valid plan.
 */
function buildPackingQubo(columns) {
  if (!columns.length) return null;
  const P = Math.max(...columns.map((c) => c.savings)) + 1;
  const q = new Qubo();
  const byShip = new Map();
  columns.forEach((c, i) => {
    const v = q.v(`z|${i}`);
    q.addLinear(v, -c.savings);
    for (const id of c.ids) {
      if (!byShip.has(id)) byShip.set(id, []);
      byShip.get(id).push(v);
    }
  });
  const seen = new Set();
  for (const vs of byShip.values()) {
    for (let i = 0; i < vs.length; i++) {
      for (let j = i + 1; j < vs.length; j++) {
        const k = vs[i] < vs[j] ? `${vs[i]},${vs[j]}` : `${vs[j]},${vs[i]}`;
        if (seen.has(k)) continue; // two columns sharing several shipments: one penalty
        seen.add(k);
        q.addQuadratic(vs[i], vs[j], P);
      }
    }
  }
  return { qubo: q, columns, penalty: P };
}

/** Sample → non-overlapping loads (any residual overlap resolved by savings). */
function decodePacking(built, sample) {
  const on = built.columns
    .filter((_, i) => sample[built.qubo.index.get(`z|${i}`)] === 1)
    .sort((x, y) => y.savings - x.savings);
  const used = new Set();
  const plan = [];
  for (const c of on) {
    if (c.ids.some((id) => used.has(id))) continue;
    c.ids.forEach((id) => used.add(id));
    plan.push(c.ids);
  }
  return plan;
}

/** Warm start vector: the seed plan's columns switched on. */
function warmStart(built, seedPlan) {
  const x = new Uint8Array(built.qubo.size);
  const want = new Set(seedPlan.map((g) => keyOf(g)));
  built.columns.forEach((c, i) => { if (want.has(keyOf(c.ids))) x[built.qubo.index.get(`z|${i}`)] = 1; });
  return x;
}

// ── exact repair + polish (shared by both methods) ──────────────────

/** Shed members until the load is feasible and profitable (or < 2 left). */
function repair(group, evaluate) {
  let g = group.slice();
  while (g.length > 1 && !goodLoad(evaluate(g))) {
    let bestG = null;
    let bestS = -Infinity;
    for (let i = 0; i < g.length; i++) {
      const h = g.slice(0, i).concat(g.slice(i + 1));
      const ev = h.length > 1 ? evaluate(h) : { feasible: true, savings: 0 };
      const s = ev.feasible ? ev.savings : -Infinity;
      if (s > bestS) { bestS = s; bestG = h; }
    }
    g = bestG;
  }
  return g.length > 1 && goodLoad(evaluate(g)) ? g : null;
}

/** Local search on exact savings: insert solos, move members between loads. */
function polish(groups, ids, evaluate, rounds) {
  let plan = groups.map((g) => g.slice());
  const sav = (g) => (g.length > 1 ? (goodLoad(evaluate(g)) ? evaluate(g).savings : -Infinity) : 0);

  for (let r = 0; r < rounds; r++) {
    let improved = false;
    const inPlan = new Set(plan.flat());
    const solos = ids.filter((id) => !inPlan.has(id));

    // insert a solo into an existing load
    for (const id of solos) {
      let best = null;
      for (let gi = 0; gi < plan.length; gi++) {
        const delta = sav([...plan[gi], id]) - sav(plan[gi]);
        if (delta > 1e-6 && (!best || delta > best.delta)) best = { gi, delta };
      }
      if (best) { plan[best.gi] = [...plan[best.gi], id]; improved = true; }
    }

    // pair two solos into a new load
    const left = ids.filter((id) => !new Set(plan.flat()).has(id));
    const used = new Set();
    const cand = [];
    for (let a = 0; a < left.length; a++) {
      for (let b = a + 1; b < left.length; b++) {
        const s = sav([left[a], left[b]]);
        if (s > 1e-6) cand.push([s, left[a], left[b]]);
      }
    }
    cand.sort((x, y) => y[0] - x[0]);
    for (const [, a, b] of cand) {
      if (used.has(a) || used.has(b)) continue;
      used.add(a); used.add(b);
      plan.push([a, b]);
      improved = true;
    }

    // move one member to another load (or out to solo)
    for (let gi = 0; gi < plan.length; gi++) {
      for (const id of plan[gi].slice()) {
        const from = plan[gi];
        const without = from.filter((x) => x !== id);
        const base = sav(from);
        let best = { to: -1, delta: sav(without) - base }; // to solo
        for (let gj = 0; gj < plan.length; gj++) {
          if (gj === gi) continue;
          const d = sav(without) + sav([...plan[gj], id]) - base - sav(plan[gj]);
          if (d > best.delta) best = { to: gj, delta: d };
        }
        if (best.delta > 1e-6) {
          plan[gi] = without;
          if (best.to >= 0) plan[best.to] = [...plan[best.to], id];
          improved = true;
        }
      }
    }

    plan = plan.filter((g) => g.length > 1);
    if (!improved) break;
  }
  return plan.map((g) => repair(g, evaluate)).filter(Boolean);
}

/** Classical baseline: repeatedly merge the two loads with the best exact gain. */
function greedyMerge(ids, evaluate) {
  let groups = ids.map((id) => [id]);
  const sav = (g) => (g.length > 1 ? evaluate(g).savings : 0);
  for (;;) {
    let best = null;
    for (let a = 0; a < groups.length; a++) {
      for (let b = a + 1; b < groups.length; b++) {
        const merged = [...groups[a], ...groups[b]];
        const ev = evaluate(merged);
        if (!goodLoad(ev)) continue;
        const gain = ev.savings - sav(groups[a]) - sav(groups[b]);
        if (gain > 1e-6 && (!best || gain > best.gain)) best = { a, b, merged, gain };
      }
    }
    if (!best) break;
    groups = groups.filter((_, i) => i !== best.a && i !== best.b);
    groups.push(best.merged);
  }
  return groups.filter((g) => g.length > 1);
}

// ── sampling: local annealer or D-Wave ─────────────────────────────

/** Column indices of a plan's loads that exist in the pool. */
function planColumnIndices(built, plan) {
  const pos = new Map(built.columns.map((c, i) => [keyOf(c.ids), i]));
  return plan.map((g) => pos.get(keyOf(g))).filter((i) => i !== undefined);
}

/** Proven optimum over one bucket's candidate pool (exact.js). */
function exactBucket(p, opts) {
  const r = solvePacking(p.built.columns, { incumbent: planColumnIndices(p.built, p.greedy), timeLimitMs: opts.exactTimeLimitMs });
  const x = new Uint8Array(p.built.qubo.size);
  for (const k of r.chosen) x[p.built.qubo.index.get(`z|${k}`)] = 1;
  return { ...r, sample: x };
}

/**
 * Sample every bucket's QUBO with the chosen sampler.
 *   local         annealer.js per bucket, warm-started from greedy
 *   sb            bifurcation.js per bucket (simulated bifurcation,
 *                 quantum-inspired; random starts, no warm start)
 *   exact         exact.js per bucket: proven optimum over the pool
 *   dwave-hybrid  ONE Leap hybrid call for the whole batch: buckets are
 *   dwave-sa      independent, so their QUBOs are merged (labels prefixed
 *                 "b<n>:") and the sample split back. One billed call per
 *                 planning run instead of one per bucket.
 *   dwave-qpu     one QPU call per bucket (embedding limits rule out merging)
 * @returns {Promise<{samples:Array<{sample:Uint8Array,energy:number}|null>, dwave:object|null}>}
 */
async function sampleAll(prepared, opts) {
  const sampler = opts.sampler || 'local';

  if (sampler === 'local') {
    const t0 = Date.now();
    const samples = prepared.map((p, i) => {
      if (!p.built) return null;
      const remaining = opts.timeLimitMs - (Date.now() - t0);
      const perBucket = Math.max(50, Math.floor(remaining / Math.max(1, prepared.length - i)));
      const sa = anneal(p.built.qubo, {
        reads: opts.reads, sweeps: opts.sweeps, seed: opts.seed,
        timeLimitMs: perBucket, initial: warmStart(p.built, p.greedy),
      });
      return { sample: sa.sample, energy: sa.energy, reads: sa.reads, sweeps: sa.sweeps };
    });
    return { samples, dwave: null };
  }

  if (sampler === 'sb') {
    const t0 = Date.now();
    const samples = prepared.map((p, i) => {
      if (!p.built) return null;
      const remaining = opts.timeLimitMs - (Date.now() - t0);
      const perBucket = Math.max(50, Math.floor(remaining / Math.max(1, prepared.length - i)));
      const sb = bifurcate(p.built.qubo, {
        agents: opts.sbAgents, steps: opts.sbSteps, mode: opts.sbMode, seed: opts.seed, timeLimitMs: perBucket,
      });
      return { sample: sb.sample, energy: sb.energy, agents: sb.agents, steps: sb.steps };
    });
    return { samples, dwave: null };
  }

  if (sampler === 'exact') {
    const samples = prepared.map((p) => {
      if (!p.built) return null;
      const r = exactBucket(p, opts);
      return { sample: r.sample, energy: p.built.qubo.energy(r.sample), exact: r };
    });
    return { samples, dwave: null };
  }

  const dwave = opts.dwaveSampler || require('./dwaveSampler');
  const params = { ...(opts.dwaveParams || {}) };
  const toArray = (built, prefix, dict) => {
    const x = new Uint8Array(built.qubo.size);
    built.qubo.labels.forEach((l, i) => { x[i] = dict[prefix + l] ? 1 : 0; });
    return x;
  };

  if (sampler === 'dwave-qpu') {
    const samples = [];
    const calls = [];
    for (const p of prepared) {
      if (!p.built) { samples.push(null); continue; }
      const r = await dwave.sample(p.built.qubo.toBqm(), sampler, params, `Zoree consolidation ${p.bucket.key}`);
      const x = toArray(p.built, '', r.sample);
      samples.push({ sample: x, energy: p.built.qubo.energy(x) });
      calls.push({ bucket: p.bucket.key, solver: r.solver, problem_id: r.problem_id, timing: r.timing, variables: r.num_variables });
    }
    return { samples, dwave: { sampler, calls } };
  }

  // hybrid / sa: one merged BQM for the batch
  const merged = { vartype: 'BINARY', linear: {}, quadratic: {}, offset: 0 };
  prepared.forEach((p, i) => {
    if (!p.built) return;
    const bqm = p.built.qubo.toBqm();
    const pre = `b${i}:`;
    for (const [l, h] of Object.entries(bqm.linear)) merged.linear[pre + l] = h;
    for (const [k, j] of Object.entries(bqm.quadratic)) {
      const [x, y] = k.split('||');
      merged.quadratic[`${pre}${x}||${pre}${y}`] = j;
    }
    merged.offset += bqm.offset;
  });
  if (!Object.keys(merged.linear).length) return { samples: prepared.map(() => null), dwave: { sampler, calls: [] } };

  if (sampler === 'dwave-sa' && opts.seed !== undefined && params.seed === undefined) params.seed = opts.seed;
  const r = await dwave.sample(merged, sampler, params, 'Zoree consolidation');
  const samples = prepared.map((p, i) => {
    if (!p.built) return null;
    const x = toArray(p.built, `b${i}:`, r.sample);
    return { sample: x, energy: p.built.qubo.energy(x) };
  });
  return {
    samples,
    dwave: { sampler, calls: [{ bucket: 'all (merged)', solver: r.solver, problem_id: r.problem_id, timing: r.timing, variables: r.num_variables, energy: r.energy }] },
  };
}

// ── batch ───────────────────────────────────────────────────────────

/**
 * Consolidate a batch.
 * @param {ReturnType<import('./costModel').createCostModel>} model
 * @param {object} [options]  see DEFAULTS; plus exportQubo, sampler
 *   ('local' | 'dwave-hybrid' | 'dwave-qpu' | 'dwave-sa'), dwaveParams
 */
async function consolidate(model, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const evaluate = memoEvaluator(model);
  const t0 = Date.now();

  const unpriced = model.ids.filter((id) => !model.standalone(id));
  const priced = model.ids.filter((id) => model.standalone(id));
  const buckets = bucketize(model, priced, opts.maxBucket);

  // 1. classical: greedy baseline, candidate loads, QUBO per bucket
  const prepared = buckets.map((bucket) => {
    const greedy = polish(greedyMerge(bucket.ids, evaluate), bucket.ids, evaluate, opts.polishRounds);
    const columns = buildColumnPool(bucket.ids, evaluate, opts, greedy);
    return { bucket, greedy, greedySavings: planSavings(greedy, evaluate), columns, built: buildPackingQubo(columns) };
  });

  // 2. sample — the only step that differs between local and D-Wave
  const tSample = Date.now();
  const { samples, dwave } = await sampleAll(prepared, opts);
  const sampleMs = Date.now() - tSample;

  // 3. classical: decode, exact repair/polish, keep the better plan
  const groups = [];
  const stats = [];
  const qubos = [];
  prepared.forEach((p, i) => {
    const s = samples[i];
    const base = { key: p.bucket.key, shipments: p.bucket.ids.length, columns: p.columns.length };
    if (!p.built || !s) {
      stats.push({ ...base, qubo_vars: 0, qubo_savings: 0, greedy_savings: 0, winner: 'none', note: 'no feasible profitable load in this bucket' });
      return;
    }
    const quantum = polish(decodePacking(p.built, s.sample), p.bucket.ids, evaluate, opts.polishRounds);
    const quantumSavings = planSavings(quantum, evaluate);
    const chosenSavings = Math.max(quantumSavings, p.greedySavings);
    const winner = quantumSavings > p.greedySavings + 0.005 ? 'qubo' : quantumSavings < p.greedySavings - 0.005 ? 'greedy' : 'tie';
    const plan = winner === 'greedy' ? p.greedy : quantum;
    const method = winner === 'greedy' ? 'greedy' : 'qubo';
    plan.forEach((ids, k) => groups.push({ key: `${p.bucket.key}:${k + 1}`, ids, method }));
    const opt = s.exact || (opts.optimalityGap ? exactBucket(p, opts) : null);
    stats.push({
      ...base,
      qubo_vars: p.built.qubo.size,
      qubo_couplers: p.built.qubo.quad.size,
      energy: Math.round(s.energy * 100) / 100,
      ...(s.reads ? { reads: s.reads, sweeps: s.sweeps } : {}),
      ...(s.agents ? { agents: s.agents, steps: s.steps } : {}),
      qubo_savings: Math.round(quantumSavings * 100) / 100,
      greedy_savings: Math.round(p.greedySavings * 100) / 100,
      winner,
      ...(opt ? {
        pool_optimum: Math.round(opt.savings * 100) / 100,
        optimum_proven: opt.proven,
        gap_pct: opt.savings > 0 ? Math.round(((opt.savings - chosenSavings) / opt.savings) * 10000) / 100 : 0,
      } : {}),
    });
    if (opts.exportQubo) {
      qubos.push({
        bucket: p.bucket.key,
        bqm: {
          ...p.built.qubo.toBqm(),
          // label → load, so a sample from any sampler decodes back into shipments
          columns: p.built.columns.map((c, k) => ({ label: `z|${k}`, shipment_ids: c.ids, savings: Math.round(c.savings * 100) / 100 })),
          js_best_energy: Math.round(s.energy * 100) / 100,
        },
      });
    }
  });

  return {
    groups, evaluate, stats, qubos, unpriced, buckets: buckets.length,
    sampler: opts.sampler || 'local', dwave, timing_ms: { total: Date.now() - t0, sampling: sampleMs },
  };
}

module.exports = {
  consolidate,
  DEFAULTS,
  _internals: { sampleAll, exactBucket, planColumnIndices, bucketize, buildColumnPool, buildPackingQubo, decodePacking, warmStart, repair, polish, greedyMerge, memoEvaluator, planSavings },
};
