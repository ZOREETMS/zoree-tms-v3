const test = require('node:test');
const assert = require('node:assert');
const mapper = require('../services/quantumEngineMapper');
const { preflightOrders } = require('../services/quantumPreflight');
const { createQuantumPlanning, _internals } = require('../services/quantumPlanning');

// ── fixtures ──────────────────────────────────────────────────────
const GEO = {
  '60601': { lat: 41.88, lng: -87.62, city: 'Chicago', state: 'IL' },
  '48201': { lat: 42.35, lng: -83.06, city: 'Detroit', state: 'MI' },
  '75201': { lat: 32.79, lng: -96.80, city: 'Dallas', state: 'TX' },
};
const fakeZipGeo = {
  load: async () => {},
  resolveGeo: (z) => GEO[String(z)] || null,
  regionOf: ({ zip }) => (GEO[zip] ? require('../constants/usRegions').regionForState(GEO[zip].state) : null),
};
const order = (id, extra = {}) => ({
  id, status: 'Unplanned', origin_zip: '60601', dest_zip: '48201',
  weight: 10000, ready: '2026-11-02T08:00:00Z', due: '2026-11-04T08:00:00Z', ...extra,
});
const TABLES = {
  orders: [order('A'), order('B'), order('H', { hazmat: true }), order('NOWT', { weight: null })],
  carriers: [{ id: 'C1', name: 'Acme', mode: 'TL', cost_per_mile: 2.1, on_time_pct: 96 }],
  rates: [{ id: 1, carrier: 'C1', status: 'active', unit: 'per lb', rate: '0.05', origin_zip: '60601', dest_zip: '48201' }],
  shipments: [],
  equipment_types: [{ code: 'DV53', max_weight: 45000, max_volume: 3800 }, { code: 'LTL', max_weight: 20000, max_volume: 2000 }],
};
function fakeDb(tables = TABLES, calls = []) {
  return async (table, q = {}) => {
    calls.push({ table, q });
    let rows = tables[table] || [];
    for (const [col, op, val] of q.filters || []) {
      if (op === 'in') rows = rows.filter((r) => val.includes(r[col]));
      if (op === 'is') rows = rows.filter((r) => (r[col] ?? null) === val);
    }
    return rows;
  };
}
function build({ engineResult, tables, calls, engineCalls = [] } = {}) {
  return createQuantumPlanning({
    dbSelect: fakeDb(tables, calls),
    zipGeo: fakeZipGeo,
    mapper,
    preflightOrders,
    engine: {
      baseUrl: 'http://engine',
      checkHealth: async () => ({ status: 'ok' }),
      optimizeConsolidate: async (p) => { engineCalls.push(['consolidate', p]); return engineResult; },
      optimizeRates: async (p) => { engineCalls.push(['rates', p]); return engineResult; },
    },
  });
}

// ── option validation ─────────────────────────────────────────────
test('rejects unknown task, bad limit, bad density', () => {
  const n = _internals.normaliseOptions;
  assert.throws(() => n({ task: 'routing' }), /task must be/);
  assert.throws(() => n({ limit: 0 }), /limit/);
  assert.throws(() => n({ densityLbPerCuft: -3 }), /density/);
  assert.throws(() => n({ orderIds: 'A,B' }), /array/);
  assert.equal(n({ limit: 999999 }).limit, 5000);
  assert.deepEqual(n({ orderIds: ['A', ' A ', ''] }).orderIds, ['A']);
});

// ── pipeline ──────────────────────────────────────────────────────
test('without density, orders have no volume so the run is blocked and the engine is never called', async () => {
  const engineCalls = [];
  const r = await build({ engineCalls }).plan({ task: 'consolidate' });
  assert.equal(r.status, 'blocked');
  assert.equal(engineCalls.length, 0);
  assert.match(r.summary.hint, /densityLbPerCuft/);
});

test('dry run maps eligible orders, excludes hazmat, skips missing weight, sends nothing', async () => {
  const engineCalls = [];
  const r = await build({ engineCalls }).plan({ task: 'consolidate', densityLbPerCuft: 12, dryRun: true });
  assert.equal(r.status, 'dry_run');
  assert.equal(engineCalls.length, 0);
  assert.deepEqual(r.payload.shipments.map((s) => s.id).sort(), ['A', 'B']);
  assert.equal(r.summary.preflight.by_rule.hazmat, 1);
  assert.equal(r.summary.shipments.skipped, 1);
  assert.deepEqual(r.summary.volume_estimated_ids.sort(), ['A', 'B']);
  assert.equal(r.payload.carriers[0].weight_cap_lbs, 45000);
  assert.equal(r.writes, 'none — proposal only');
});

test('consolidate re-validates groups: an over-cap group is infeasible and not counted as savings', async () => {
  const engineResult = { groups: [
    { group_id: 'G1', carrier_id: 'C1', combined_weight_lbs: 20000, combined_volume_cuft: 1666, savings: 300 },
    { group_id: 'G2', carrier_id: 'C1', combined_weight_lbs: 90000, combined_volume_cuft: 7500, savings: 5000 },
  ] };
  const r = await build({ engineResult }).plan({ task: 'consolidate', densityLbPerCuft: 12 });
  assert.equal(r.status, 'ok');
  assert.equal(r.validated, true);
  assert.equal(r.totals.groups_feasible, 1);
  assert.equal(r.totals.groups_infeasible, 1);
  assert.equal(r.totals.feasible_savings, 300);
  assert.equal(r.totals.claimed_savings, 5300);
  assert.match(r.infeasible[0].violations.join(' '), /weight 90000 > cap 45000/);
});

test('rates result is returned untouched and labelled unvalidated', async () => {
  const engineResult = { assignments: [{ shipment_id: 'A', carrier_id: 'C1' }] };
  const engineCalls = [];
  const r = await build({ engineResult, engineCalls }).plan({ task: 'rates', densityLbPerCuft: 12 });
  assert.equal(r.status, 'ok');
  assert.equal(r.validated, false);
  assert.deepEqual(r.engine_result, engineResult);
  assert.equal(engineCalls[0][0], 'rates');
});

test('explicit orderIds are loaded in chunks and missing ids are reported', async () => {
  const calls = [];
  const ids = Array.from({ length: 450 }, (_, i) => `X${i}`).concat(['A']);
  const r = await build({ calls }).plan({ task: 'consolidate', orderIds: ids, densityLbPerCuft: 12, dryRun: true });
  const orderCalls = calls.filter((c) => c.table === 'orders');
  assert.equal(orderCalls.length, 3);                         // 200 + 200 + 51
  assert.ok(orderCalls.every((c) => c.q.filters[0][2].length <= 200));
  assert.equal(r.summary.orders_not_found.length, 450);
  assert.deepEqual(r.payload.shipments.map((s) => s.id), ['A']);
});

test('without ids, only unplanned orders are requested', async () => {
  const calls = [];
  await build({ calls }).plan({ densityLbPerCuft: 12, dryRun: true });
  const q = calls.find((c) => c.table === 'orders').q;
  assert.deepEqual(q.filters, [['shipment_id', 'is', null]]);
});

test('status never throws when the engine is down', async () => {
  const p = createQuantumPlanning({
    dbSelect: fakeDb(), zipGeo: fakeZipGeo, mapper, preflightOrders,
    engine: { baseUrl: 'http://engine', checkHealth: async () => { throw new Error('unreachable'); } },
  });
  const s = await p.status();
  assert.equal(s.reachable, false);
  assert.match(s.error, /unreachable/);
});

// ── engine selection: Zoree QUBO engine vs Otodus ─────────────────
const localEngine = require('../services/quantumLocal');
function buildBoth({ engineCalls = [], defaultEngine } = {}) {
  return createQuantumPlanning({
    dbSelect: fakeDb(), zipGeo: fakeZipGeo, mapper, preflightOrders,
    engine: {
      baseUrl: 'http://engine',
      checkHealth: async () => ({ status: 'ok' }),
      optimizeConsolidate: async (p) => { engineCalls.push(['otodus', p]); return { groups: [] }; },
      optimizeRates: async () => ({ assignments: [] }),
    },
    localEngine,
    defaultEngine,
  });
}

test('zoree is the default when configured: A and B consolidate, re-validation finds nothing infeasible', async () => {
  const engineCalls = [];
  const r = await buildBoth({ engineCalls }).plan({ task: 'consolidate', densityLbPerCuft: 12, seed: 1 });
  assert.equal(r.status, 'ok');
  assert.equal(r.engine, 'zoree');
  assert.equal(engineCalls.length, 0);                       // vendor never called
  assert.equal(r.totals.groups_infeasible, 0);
  assert.deepEqual(r.feasible.map((g) => g.shipment_ids), [['A', 'B']]);
  assert.ok(r.totals.feasible_savings > 0);
  assert.ok(r.benchmark && r.solver && Array.isArray(r.unconsolidated));
  assert.equal(r.writes, 'none — proposal only');
});

test('engine option routes to otodus and passes service windows as context', async () => {
  const engineCalls = [];
  const r = await buildBoth({ engineCalls }).plan({ task: 'consolidate', densityLbPerCuft: 12, engine: 'otodus' });
  assert.equal(r.engine, 'otodus');
  assert.equal(engineCalls.length, 1);
  assert.equal(r.benchmark, undefined);
});

test('engine selection is validated', async () => {
  assert.throws(() => _internals.normaliseOptions({ engine: 'dwave' }), /engine must be/);
  assert.throws(() => _internals.normaliseOptions({ seed: -1 }), /seed/);
  await assert.rejects(build().plan({ densityLbPerCuft: 12, engine: 'zoree' }), (e) => e.status === 400);
});

test('status reports the default engine at top level and every configured engine', async () => {
  const s = await buildBoth().status();
  assert.equal(s.engine, 'zoree');
  assert.equal(s.reachable, true);
  assert.deepEqual(Object.keys(s.engines).sort(), ['otodus', 'zoree']);
  assert.equal(s.engines.zoree.health.engine, 'zoree-qubo');
});

test('sampler option is validated and only applies to the zoree engine', () => {
  const n = _internals.normaliseOptions;
  assert.equal(n({ sampler: 'DWAVE-HYBRID' }).sampler, 'dwave-hybrid');
  assert.throws(() => n({ sampler: 'ibm-q' }), /sampler must be/);
  assert.throws(() => n({ engine: 'otodus', sampler: 'dwave-hybrid' }), /zoree engine only/);
  assert.throws(() => n({ dwaveTimeLimit: 0 }), /dwaveTimeLimit/);
  assert.equal(n({ dwaveTimeLimit: 5 }).dwaveTimeLimit, 5);
});
