const test = require('node:test');
const assert = require('node:assert');
const { Qubo } = require('../services/quantumLocal/qubo');
const { anneal, mulberry32 } = require('../services/quantumLocal/annealer');
const { createCostModel } = require('../services/quantumLocal/costModel');
const { _internals: C } = require('../services/quantumLocal/consolidation');
const engine = require('../services/quantumLocal');
const { regionForState } = require('../constants/usRegions');

// ── fixtures ──────────────────────────────────────────────────────
const CHI = [41.88, -87.63, 'IL'];
const MKE = [43.04, -87.91, 'WI'];
const DET = [42.33, -83.05, 'MI'];
const TOL = [41.65, -83.54, 'OH'];
const HOU = [29.76, -95.37, 'TX'];
const DAL = [32.78, -96.80, 'TX'];
const DAY = '2026-11-10T08:00:00Z';
const DUE = '2026-11-13T08:00:00Z';

function ship(id, o, d, weight, extra = {}) {
  return {
    id, weight_lbs: weight, volume_cuft: +(weight / 12).toFixed(1), distance_miles: 0,
    origin_region: regionForState(o[2]), destination_region: regionForState(d[2]),
    origin_lat: o[0], origin_lon: o[1], destination_lat: d[0], destination_lon: d[1],
    origin_city: '', destination_city: '', sla_hours: 72, ...extra,
  };
}
const TL = { id: 'TL', name: 'Acme', base_fee: 150, rate_per_mile: 2.35, weight_cap_lbs: 45000, volume_cap_cuft: 3800, transit_multiplier: 1, reliability: 0.96 };
const LTL = { id: 'LTL', name: 'Small', base_fee: 0, rate_per_mile: 4, weight_cap_lbs: 20000, volume_cap_cuft: 2000, transit_multiplier: 1.3, reliability: 0.9 };

function synthetic(n, seed) {
  const r = mulberry32(seed);
  const O = [CHI, MKE, [41.53, -88.08, 'IL'], DAL];
  const D = [DET, TOL, [39.96, -83.0, 'OH'], HOU, [35.15, -90.05, 'TN']];
  const shipments = [];
  const windows = {};
  for (let i = 0; i < n; i++) {
    const o = O[Math.floor(r() * O.length)];
    const d = D[Math.floor(r() * D.length)];
    shipments.push(ship(`S${i}`, o, d, Math.round(2000 + r() * 16000)));
    windows[`S${i}`] = { ready: DAY, due: DUE };
  }
  const lanes = [...new Set(shipments.map((s) => `${s.origin_region}|${s.destination_region}`))];
  const rate_table = lanes.map((k) => {
    const [a, b] = k.split('|');
    return { carrier_id: 'LTL', origin_region: a, destination_region: b, rate_per_lb: 0.075, rate_per_cuft: 0, minimum_charge: 250 };
  });
  return { payload: { shipments, carriers: [TL, LTL], rate_table }, windows };
}

const FAST = { solver: { reads: 4, sweeps: 300 } };

function bruteForce(q) {
  let best = Infinity;
  const x = new Uint8Array(q.size);
  for (let m = 0; m < 1 << q.size; m++) {
    for (let i = 0; i < q.size; i++) x[i] = (m >> i) & 1;
    best = Math.min(best, q.energy(x));
  }
  return best;
}

// ── QUBO ──────────────────────────────────────────────────────────
test('addSquaredLinear expands (Σ c x + k)² exactly', () => {
  const q = new Qubo();
  const a = q.v('a'), b = q.v('b'), c = q.v('c');
  q.addSquaredLinear([[a, 2], [b, 3], [c, 1]], -4, 1.5);
  for (let m = 0; m < 8; m++) {
    const x = [m & 1, (m >> 1) & 1, (m >> 2) & 1];
    const lhs = 1.5 * (2 * x[0] + 3 * x[1] + x[2] - 4) ** 2;
    assert.ok(Math.abs(q.energy(x) - lhs) < 1e-9, `state ${x}`);
  }
});

test('toBqm uses labels and dimod-style pair keys', () => {
  const q = new Qubo();
  const a = q.v('z|0'), b = q.v('z|1');
  q.addLinear(a, -3); q.addQuadratic(b, a, 5);
  const bqm = q.toBqm();
  assert.equal(bqm.vartype, 'BINARY');
  assert.equal(bqm.linear['z|0'], -3);
  assert.equal(bqm.quadratic['z|0||z|1'], 5);
});

// ── annealer ──────────────────────────────────────────────────────
test('annealer finds the brute-force ground state of random 12-variable QUBOs', () => {
  for (const seed of [3, 9, 27]) {
    const r = mulberry32(seed);
    const q = new Qubo();
    for (let i = 0; i < 12; i++) q.addLinear(q.v(`v${i}`), r() * 10 - 5);
    for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) if (r() < 0.4) q.addQuadratic(i, j, r() * 10 - 5);
    const sa = anneal(q, { reads: 20, sweeps: 500, seed: 1 });
    assert.ok(Math.abs(sa.energy - bruteForce(q)) < 1e-6, `seed ${seed}`);
  }
});

test('annealer is deterministic for a given seed and never worse than its warm start', () => {
  const q = new Qubo();
  for (let i = 0; i < 8; i++) q.addLinear(q.v(`v${i}`), i % 2 ? -1 : 1);
  const a = anneal(q, { seed: 5, reads: 3, sweeps: 50 });
  const b = anneal(q, { seed: 5, reads: 3, sweeps: 50 });
  assert.deepEqual([...a.sample], [...b.sample]);
  const warm = Uint8Array.from([0, 1, 0, 1, 0, 1, 0, 1]); // the optimum
  assert.equal(anneal(q, { seed: 5, reads: 1, sweeps: 1, initial: warm }).energy, q.energy(warm));
});

// ── cost model ────────────────────────────────────────────────────
test('standalone price is the cheaper of truckload and rated lane', () => {
  const light = ship('L', CHI, DET, 3000);
  const heavy = ship('H', CHI, DET, 30000);
  const m = createCostModel({
    shipments: [light, heavy], carriers: [TL, LTL],
    rate_table: [{ carrier_id: 'LTL', origin_region: light.origin_region, destination_region: light.destination_region, rate_per_lb: 0.075, rate_per_cuft: 0, minimum_charge: 250 }],
  });
  assert.equal(m.standalone('L').mode, 'RATED');           // 3000 × 0.075 = 225 → minimum 250
  assert.equal(m.standalone('L').cost, 250);
  assert.equal(m.standalone('H').mode, 'TL');              // over the LTL carrier's 20,000 lb cap
});

test('a one-shipment load prices at its real mileage', () => {
  const s = ship('A', CHI, DET, 10000, { distance_miles: 283 });
  const m = createCostModel({ shipments: [s], carriers: [TL] });
  const ev = m.evaluateLoad(['A']);
  assert.ok(ev.feasible);
  assert.ok(Math.abs(ev.route_miles - 283) < 1e-6);
  assert.ok(Math.abs(ev.cost - (150 + 2.35 * 283)) < 1e-6);
});

test('evaluateLoad rejects over-capacity, out-of-route and late loads', () => {
  const w = { ready: DAY, due: DUE };
  const m = createCostModel({
    shipments: [
      ship('A', CHI, DET, 30000), ship('B', CHI, DET, 20000),          // 50,000 lb together
      ship('C', CHI, DET, 5000), ship('D', DAL, HOU, 5000),            // nowhere near each other
      ship('E', CHI, TOL, 5000), ship('F', CHI, DET, 5000),
    ],
    carriers: [TL],
  }, { windows: { A: w, B: w, C: w, D: w, E: w, F: { ready: DAY, due: '2026-11-10T13:00:00Z' } } });
  assert.match(m.evaluateLoad(['A', 'B']).violations.join(' '), /no carrier fits/);
  assert.match(m.evaluateLoad(['C', 'D']).violations.join(' '), /route .* longest leg/);
  assert.match(m.evaluateLoad(['E', 'F']).violations.join(' '), /service time/);  // F due in 5 h
  assert.ok(m.evaluateLoad(['C', 'E']).feasible);
});

test('two co-located half loads consolidate with positive savings', () => {
  const m = createCostModel({ shipments: [ship('A', CHI, DET, 15000), ship('B', CHI, DET, 15000)], carriers: [TL] });
  const ev = m.evaluateLoad(['A', 'B']);
  assert.ok(ev.feasible);
  assert.ok(ev.savings > 500);
  assert.equal(ev.sequence.length, 2);   // one pickup, one drop
});

// ── set-packing QUBO ─────────────────────────────────────────────
test('packing QUBO: booking a shipment twice is never lower energy than the best valid plan', () => {
  const cols = [{ ids: ['A', 'B'], savings: 500 }, { ids: ['B', 'C'], savings: 450 }, { ids: ['C', 'D'], savings: 300 }];
  const built = C.buildPackingQubo(cols);
  const best = bruteForce(built.qubo);
  assert.equal(best, -800);                                // {AB, CD}
  assert.ok(built.qubo.energy([1, 1, 0]) > best);          // AB + BC double-books B
  assert.deepEqual(C.decodePacking(built, Uint8Array.from([1, 0, 1])), [['A', 'B'], ['C', 'D']]);
});

// ── engine end to end ─────────────────────────────────────────────
test('every returned group is feasible, within caps, single-booked and priced consistently', async () => {
  const { payload, windows } = synthetic(36, 4);
  const r = await engine.optimizeConsolidate(payload, { windows, seed: 1, ...FAST });
  assert.ok(r.groups.length > 0);
  const seen = new Set();
  for (const g of r.groups) {
    assert.ok(g.shipment_ids.length >= 2);
    for (const id of g.shipment_ids) { assert.ok(!seen.has(id), `${id} booked twice`); seen.add(id); }
    assert.ok(g.combined_weight_lbs <= 45000 && g.combined_volume_cuft <= 3800);
    assert.ok(g.savings > 0);
    assert.ok(Math.abs(g.standalone_cost - g.load_cost - g.savings) < 0.02);
  }
  for (const id of r.unconsolidated) assert.ok(!seen.has(id));
  assert.equal(seen.size + r.unconsolidated.length + r.unpriced.length, payload.shipments.length);
});

test('QUBO plan is never worse than the greedy baseline it is warm-started from', async () => {
  for (const seed of [4, 8]) {
    const { payload, windows } = synthetic(40, seed);
    const r = await engine.optimizeConsolidate(payload, { windows, seed: 1, ...FAST });
    for (const b of r.solver.buckets) assert.ok(b.qubo_savings >= b.greedy_savings - 0.01, b.key);
    assert.ok(r.benchmark.chosen_savings >= r.benchmark.greedy_savings - 0.05);
  }
});

test('same batch + same seed → same plan', async () => {
  const { payload, windows } = synthetic(30, 6);
  const a = await engine.optimizeConsolidate(payload, { windows, seed: 42, ...FAST });
  const b = await engine.optimizeConsolidate(payload, { windows, seed: 42, ...FAST });
  assert.deepEqual(a.groups.map((g) => g.shipment_ids), b.groups.map((g) => g.shipment_ids));
});

test('exportQubo ships a dimod-loadable BQM with the column table', async () => {
  const { payload, windows } = synthetic(24, 2);
  const r = await engine.optimizeConsolidate(payload, { windows, exportQubo: true, ...FAST });
  assert.ok(r.qubos.length > 0);
  const { bqm } = r.qubos[0];
  assert.equal(bqm.vartype, 'BINARY');
  assert.ok(bqm.columns.every((c) => c.label in bqm.linear && c.shipment_ids.length >= 2));
});

test('rates assigns the cheapest standalone carrier and lists unpriced shipments', async () => {
  const r = await engine.optimizeRates({ shipments: [ship('A', CHI, DET, 30000), ship('X', CHI, DET, 60000)], carriers: [TL] });
  assert.deepEqual(r.assignments.map((a) => [a.shipment_id, a.carrier_id, a.mode]), [['A', 'TL', 'TL']]);
  assert.deepEqual(r.unpriced, ['X']);   // heavier than any trailer
});

test('bad payloads are a 400, not a crash', async () => {
  await assert.rejects(engine.optimizeConsolidate({}), (e) => e.status === 400);
});

// ── D-Wave sampler path (stand-in sampler: no Python, no token, no cost) ──
const { consolidate } = require('../services/quantumLocal/consolidation');
const dwaveSampler = require('../services/quantumLocal/dwaveSampler');

/** Fake D-Wave: rebuild the BQM it is sent and anneal it locally. */
function fakeDwave(calls) {
  return {
    sample: async (bqm, which, params, label) => {
      calls.push({ which, labels: Object.keys(bqm.linear), label });
      const q = new Qubo();
      for (const [l, h] of Object.entries(bqm.linear)) q.addLinear(q.v(l), h);
      for (const [k, j] of Object.entries(bqm.quadratic)) { const [a, b] = k.split('||'); q.addQuadratic(q.v(a), q.v(b), j); }
      const sa = anneal(q, { reads: 4, sweeps: 300, seed: 3 });
      const sample = {};
      q.labels.forEach((l, i) => { sample[l] = sa.sample[i]; });
      return { sample, energy: sa.energy + bqm.offset, solver: `fake-${which}`, problem_id: 'p-1', timing: {}, num_variables: q.size };
    },
  };
}

test('dwave-hybrid sends ONE merged BQM per batch and decodes every bucket from it', async () => {
  const { payload, windows } = synthetic(40, 8);
  const calls = [];
  const model = createCostModel(payload, { windows });
  const r = await consolidate(model, { sampler: 'dwave-hybrid', dwaveSampler: fakeDwave(calls), reads: 4, sweeps: 300 });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].labels.every((l) => /^b\d+:z\|\d+$/.test(l)));                 // bucket-prefixed labels
  const sampled = r.stats.filter((s) => s.qubo_vars > 0);
  assert.ok(sampled.length > 1);
  assert.equal(new Set(calls[0].labels.map((l) => l.split(':')[0])).size, sampled.length);
  assert.equal(r.dwave.calls[0].solver, 'fake-dwave-hybrid');
  for (const g of r.groups) assert.ok(r.evaluate(g.ids).feasible);
});

test('dwave-qpu sends one call per bucket', async () => {
  const { payload, windows } = synthetic(40, 8);
  const calls = [];
  const r = await consolidate(createCostModel(payload, { windows }), { sampler: 'dwave-qpu', dwaveSampler: fakeDwave(calls) });
  assert.equal(calls.length, r.stats.filter((s) => s.qubo_vars > 0).length);
  assert.ok(calls.every((c) => c.labels.every((l) => /^z\|\d+$/.test(l))));
});

test('D-Wave failures surface as errors — no silent fallback to the local solver', async () => {
  const { payload, windows } = synthetic(24, 2);
  const failing = { sample: async () => { throw Object.assign(new Error('D-Wave auth error: Invalid token'), { status: 502 }); } };
  await assert.rejects(
    consolidate(createCostModel(payload, { windows }), { sampler: 'dwave-hybrid', dwaveSampler: failing }),
    (e) => e.status === 502 && /Invalid token/.test(e.message),
  );
});

test('engine rejects an unknown sampler', async () => {
  const { payload, windows } = synthetic(10, 1);
  await assert.rejects(engine.optimizeConsolidate(payload, { windows, sampler: 'ibm' }), (e) => e.status === 400);
});

test('missing Python is a 503 with install instructions, and check() never throws', async () => {
  const prev = process.env.DWAVE_PYTHON;
  process.env.DWAVE_PYTHON = 'definitely-not-a-python-exe';
  try {
    await assert.rejects(dwaveSampler.sample({ linear: { a: -1 }, quadratic: {}, offset: 0 }, 'dwave-sa'), (e) => e.status === 503 && /dwave-ocean-sdk/.test(e.message));
    const c = await dwaveSampler.check();
    assert.equal(c.ocean, null);
  } finally {
    if (prev === undefined) delete process.env.DWAVE_PYTHON; else process.env.DWAVE_PYTHON = prev;
  }
});
