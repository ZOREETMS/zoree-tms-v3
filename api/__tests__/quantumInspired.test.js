// Quantum-inspired and exact samplers: bifurcation.js, exact.js, and their
// wiring through consolidation.js / the engine.
const test = require('node:test');
const assert = require('node:assert');
const { Qubo } = require('../services/quantumLocal/qubo');
const { mulberry32 } = require('../services/quantumLocal/annealer');
const { bifurcate } = require('../services/quantumLocal/bifurcation');
const { solvePacking } = require('../services/quantumLocal/exact');
const engine = require('../services/quantumLocal');
const { _internals: planning } = require('../services/quantumPlanning');
const { synthetic } = require('../../scripts/quantum/benchmark');

function randomQubo(n, seed, density = 0.3) {
  const r = mulberry32(seed);
  const q = new Qubo();
  for (let i = 0; i < n; i++) { q.v(`v${i}`); q.addLinear(i, (r() - 0.5) * 10); }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (r() < density) q.addQuadratic(i, j, (r() - 0.5) * 10);
  return q;
}

function bruteForce(q) {
  let best = Infinity;
  const x = new Uint8Array(q.size);
  for (let m = 0; m < 1 << q.size; m++) {
    for (let i = 0; i < q.size; i++) x[i] = (m >> i) & 1;
    best = Math.min(best, q.energy(x));
  }
  return best;
}

function randomColumns(seed, shipments = 10, count = 20) {
  const r = mulberry32(seed);
  const cols = [];
  for (let c = 0; c < count; c++) {
    const size = 2 + Math.floor(r() * 3);
    const ids = new Set();
    while (ids.size < size) ids.add(`S${Math.floor(r() * shipments)}`);
    cols.push({ ids: [...ids], savings: Math.round(r() * 1000) / 10 });
  }
  return cols;
}

function bestPacking(cols) {
  let best = 0;
  (function rec(i, used, v) {
    if (v > best) best = v;
    for (let k = i; k < cols.length; k++) {
      if (cols[k].ids.some((x) => used.has(x))) continue;
      const u = new Set(used);
      cols[k].ids.forEach((x) => u.add(x));
      rec(k + 1, u, v + cols[k].savings);
    }
  })(0, new Set(), 0);
  return best;
}

function assertValidPlan(res) {
  const seen = new Set();
  for (const g of res.groups) {
    for (const id of g.shipment_ids) {
      assert.ok(!seen.has(id), `shipment ${id} booked twice`);
      seen.add(id);
    }
    assert.ok(g.savings > 0);
  }
}

// ── simulated bifurcation ─────────────────────────────────────────
test('simulated bifurcation finds the ground state of small random QUBOs', () => {
  let hits = 0;
  for (let s = 1; s <= 20; s++) {
    const q = randomQubo(14, s);
    if (Math.abs(bifurcate(q, { seed: s }).energy - bruteForce(q)) < 1e-6) hits++;
  }
  assert.ok(hits >= 19, `ground state on ${hits}/20`);
});

test('both SB modes work without the descent step', () => {
  for (const mode of ['discrete', 'ballistic']) {
    let hits = 0;
    for (let s = 1; s <= 10; s++) {
      const q = randomQubo(12, 100 + s);
      if (Math.abs(bifurcate(q, { seed: s, mode, descent: false }).energy - bruteForce(q)) < 1e-6) hits++;
    }
    assert.ok(hits >= 8, `${mode}: ground state on ${hits}/10`);
  }
});

test('simulated bifurcation is reproducible, energy matches its sample, and handles edge cases', () => {
  const q = randomQubo(20, 7);
  const a = bifurcate(q, { seed: 3 });
  const b = bifurcate(q, { seed: 3 });
  assert.deepEqual([...a.sample], [...b.sample]);
  assert.ok(Math.abs(q.energy(a.sample) - a.energy) < 1e-9);
  assert.equal(bifurcate(new Qubo(), {}).sample.length, 0);
  assert.throws(() => bifurcate(q, { mode: 'quantum' }), /mode must be/);
});

// ── exact set packing ─────────────────────────────────────────────
test('exact solver matches brute force and returns a valid packing', () => {
  for (let s = 1; s <= 40; s++) {
    const cols = randomColumns(s);
    const r = solvePacking(cols);
    assert.ok(r.proven);
    assert.ok(Math.abs(r.savings - bestPacking(cols)) < 1e-6, `seed ${s}`);
    const used = new Set();
    let total = 0;
    for (const k of r.chosen) {
      for (const id of cols[k].ids) { assert.ok(!used.has(id)); used.add(id); }
      total += cols[k].savings;
    }
    assert.ok(Math.abs(total - r.savings) < 1e-6);
  }
});

test('exact solver keeps the incumbent and reports unproven when a limit is hit', () => {
  const cols = randomColumns(5, 14, 60);
  const r = solvePacking(cols, { incumbent: [0], nodeLimit: 1 });
  assert.equal(r.proven, false);
  assert.ok(r.savings >= cols[0].savings - 1e-9);
  assert.deepEqual(solvePacking([]), { chosen: [], savings: 0, proven: true, nodes: 1, ms: solvePacking([]).ms });
});

// ── engine wiring ─────────────────────────────────────────────────
test('sb and exact samplers produce valid plans; exact reports a proven pool optimum', async () => {
  const { payload, windows } = synthetic(40, 3);
  const sb = await engine.optimizeConsolidate(payload, { windows, sampler: 'sb', solver: { sbAgents: 8, sbSteps: 300 } });
  assertValidPlan(sb);
  assert.match(sb.solver.type, /simulated bifurcation/);
  assert.equal(sb.benchmark.optimality, undefined);

  const ex = await engine.optimizeConsolidate(payload, { windows, sampler: 'exact' });
  assertValidPlan(ex);
  const o = ex.benchmark.optimality;
  assert.equal(o.buckets_proven, o.buckets_solved);
  assert.ok(o.gap_pct <= 1e-9, 'exact plan cannot be below the pool optimum');
});

test('optimalityGap reports the gap for any sampler, and exact is never beaten on the pool', async () => {
  const { payload, windows } = synthetic(60, 9);
  const sa = await engine.optimizeConsolidate(payload, { windows, optimalityGap: true, solver: { reads: 4, sweeps: 300 } });
  assertValidPlan(sa);
  const o = sa.benchmark.optimality;
  assert.ok(o && o.buckets_solved > 0);
  for (const b of sa.solver.buckets.filter((x) => x.pool_optimum !== undefined)) {
    assert.equal(typeof b.gap_pct, 'number');
    assert.equal(b.optimum_proven, true);
  }
  const ex = await engine.optimizeConsolidate(payload, { windows, sampler: 'exact' });
  assert.ok(ex.benchmark.optimality.pool_optimum_savings + 1e-6 >= o.pool_optimum_savings - 1e-6);
});

test('planning accepts the new samplers and the optimalityGap flag', () => {
  const n = planning.normaliseOptions;
  assert.equal(n({ sampler: 'SB' }).sampler, 'sb');
  assert.equal(n({ sampler: 'exact' }).sampler, 'exact');
  assert.equal(n({ optimalityGap: true }).optimalityGap, true);
  assert.equal(n({}).optimalityGap, false);
  assert.ok(engine.SAMPLERS.includes('sb') && engine.SAMPLERS.includes('exact'));
});
