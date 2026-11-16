'use strict';

const test = require('node:test');
const assert = require('node:assert');
const m = require('../services/quantumEngineMapper');
const { regionForState } = require('../constants/usRegions');

const GEO = {
  '60601': { lat: 41.8858, lng: -87.6181, city: 'Chicago', state: 'IL' },
  '48226': { lat: 42.3314, lng: -83.0458, city: 'Detroit', state: 'MI' },
  '90012': { lat: 34.0614, lng: -118.2385, city: 'Los Angeles', state: 'CA' },
  '00901': { lat: 18.4655, lng: -66.1057, city: 'San Juan', state: 'PR' },
};
const resolveGeo = (z) => GEO[z] || null;

const order = (over = {}) => ({
  id: 'ORD1', origin_zip: '60601', dest_zip: '48226',
  weight: 450, ready: '2026-09-10', due: '2026-09-11', ...over,
});

// ── regions ────────────────────────────────────────────────────────
test('regionForState maps case-insensitively and rejects unknowns', () => {
  assert.equal(regionForState('il'), 'Midwest');
  assert.equal(regionForState('TX'), 'South');
  assert.equal(regionForState('CA'), 'West');
  assert.equal(regionForState('NY'), 'Northeast');
  assert.equal(regionForState('ZZ'), null);
  assert.equal(regionForState(null), null);
});

test('territories map to no region so the mapper skips them loudly', () => {
  assert.equal(regionForState('PR'), null);
  const r = m.toEngineShipments([order({ dest_zip: '00901' })], { resolveGeo });
  assert.equal(r.shipments.length, 0);
  assert.match(r.skipped[0].reason, /unmapped dest state PR/);
});

// ── shipments ──────────────────────────────────────────────────────
test('maps a complete order into the engine shape', () => {
  const r = m.toEngineShipments([order({ volume_cuft: 30 })], { resolveGeo });
  assert.equal(r.shipments.length, 1);
  const s = r.shipments[0];
  assert.deepEqual(Object.keys(s).sort(), [
    'destination_city', 'destination_lat', 'destination_lon', 'destination_region',
    'distance_miles', 'id', 'origin_city', 'origin_lat', 'origin_lon',
    'origin_region', 'sla_hours', 'volume_cuft', 'weight_lbs',
  ]);
  assert.equal(s.origin_region, 'Midwest');
  assert.equal(s.destination_region, 'Midwest');
  assert.equal(s.weight_lbs, 450);
  assert.equal(s.volume_cuft, 30);
  assert.equal(s.sla_hours, 24);
  assert.ok(s.distance_miles > 200 && s.distance_miles < 400, `distance ${s.distance_miles}`);
});

test('real mileage wins over the haversine fallback', () => {
  const miles = new Map([['ORD1', 297]]);
  const r = m.toEngineShipments([order({ volume_cuft: 30 })], { resolveGeo, milesByOrderId: miles });
  assert.equal(r.shipments[0].distance_miles, 297);
});

test('every priced field is required — nothing is zero-filled', () => {
  const cases = [
    [{ weight: null }, /weight/],
    [{ weight: 0 }, /weight/],
    [{ origin_zip: null }, /origin_zip or dest_zip/],
    [{ dest_zip: '99999' }, /no geo for dest zip/],
    [{ ready: null }, /sla_hours/],
    [{ due: null }, /sla_hours/],
  ];
  for (const [over, re] of cases) {
    // volume supplied so each case isolates the field under test — without
    // it the volume guard fires first and masks the SLA cases.
    const r = m.toEngineShipments([order({ volume_cuft: 30, ...over })], { resolveGeo });
    assert.equal(r.shipments.length, 0, `expected skip for ${JSON.stringify(over)}`);
    assert.match(r.skipped[0].reason, re);
    // the critical property: nothing reaches the engine with a 0 in a priced field
    assert.equal(r.shipments.find((s) => !s.weight_lbs || !s.volume_cuft), undefined);
  }
});

test('missing volume is skipped unless density is explicitly opted into', () => {
  const without = m.toEngineShipments([order()], { resolveGeo });
  assert.equal(without.shipments.length, 0);
  assert.match(without.skipped[0].reason, /no volume_cuft and no assumedDensityLbPerCuft/);

  const withDensity = m.toEngineShipments([order()], { resolveGeo, assumedDensityLbPerCuft: 10 });
  assert.equal(withDensity.shipments.length, 1);
  assert.equal(withDensity.shipments[0].volume_cuft, 45);
  assert.deepEqual(withDensity.meta.estimated, ['ORD1']);
});

test('meta.estimated lists only shipments actually emitted', () => {
  // ORD2 gets a volume estimate then fails the SLA check — it must not be
  // reported as estimated, because it was never sent.
  const r = m.toEngineShipments(
    [order(), order({ id: 'ORD2', ready: null, due: null })],
    { resolveGeo, assumedDensityLbPerCuft: 10 }
  );
  assert.deepEqual(r.shipments.map((s) => s.id), ['ORD1']);
  assert.deepEqual(r.meta.estimated, ['ORD1']);
  assert.deepEqual(r.skipped.map((s) => s.id), ['ORD2']);
});

test('requires an injected resolveGeo', () => {
  assert.throws(() => m.toEngineShipments([order()], {}), /requires opts\.resolveGeo/);
});

// ── carriers ───────────────────────────────────────────────────────
const caps = new Map([['CAR001', { max_weight: 45000, max_volume: 3800 }]]);

test('maps carriers and converts on_time_pct to a 0-1 reliability', () => {
  const r = m.toEngineCarriers(
    [{ id: 'CAR001', name: 'Midwest Express', cost_per_mile: 1.2, on_time_pct: 98 }],
    { capsByCarrierId: caps }
  );
  assert.equal(r.carriers.length, 1);
  assert.equal(r.carriers[0].reliability, 0.98);
  assert.equal(r.carriers[0].weight_cap_lbs, 45000);
  assert.equal(r.carriers[0].volume_cap_cuft, 3800);
  assert.equal(r.carriers[0].transit_multiplier, 1.0);
});

test('a carrier with no capacity is dropped, never sent uncapped', () => {
  const r = m.toEngineCarriers(
    [{ id: 'NOCAP', name: 'No Caps', cost_per_mile: 1.1, on_time_pct: 90 }],
    { capsByCarrierId: new Map() }
  );
  assert.equal(r.carriers.length, 0);
  assert.match(r.skipped[0].reason, /no weight capacity/);
});

test('a carrier with cost_per_mile 0 is dropped — matches 10 of 11 live rows', () => {
  const r = m.toEngineCarriers(
    [{ id: 'C001', name: 'WERNER ENTERPRISES', cost_per_mile: 0, on_time_pct: 96.2 }],
    { capsByCarrierId: caps }
  );
  assert.equal(r.carriers.length, 0);
  assert.match(r.skipped[0].reason, /missing cost_per_mile/);
});

// ── rate table ─────────────────────────────────────────────────────
const regionOf = ({ zip, text }) => {
  const hit = zip && GEO[zip];
  if (hit) return regionForState(hit.state);
  const mm = text && String(text).match(/([A-Za-z]{2})\s*$/);
  return mm ? regionForState(mm[1]) : null;
};

test('converts cwt to per-lb and skips non-weight units', () => {
  const r = m.toEngineRateTable([
    { id: 1, carrier: 'CAR001', status: 'Active', unit: 'CWT', rate: '25.00', origin_zip: '60601', dest_zip: '48226' },
    { id: 2, carrier: 'CAR001', status: 'Active', unit: 'per mile', rate: '1.90', origin_zip: '60601', dest_zip: '48226' },
  ], { regionOf });
  assert.equal(r.rate_table.length, 1);
  assert.equal(r.rate_table[0].rate_per_lb, 0.25);
  assert.match(r.skipped[0].reason, /not per-weight/);
});

test('duplicate lanes collapse to the cheapest rate', () => {
  const r = m.toEngineRateTable([
    { id: 1, carrier: 'CAR001', status: 'Active', unit: 'lb', rate: '0.40', origin_zip: '60601', dest_zip: '48226' },
    { id: 2, carrier: 'CAR001', status: 'Active', unit: 'lb', rate: '0.28', origin_zip: '60601', dest_zip: '48226' },
  ], { regionOf });
  assert.equal(r.rate_table.length, 1);
  assert.equal(r.rate_table[0].rate_per_lb, 0.28);
});

// ── capacity validation (the important one) ────────────────────────
test('rejects groups that exceed the capacities we sent', () => {
  const engineCarriers = m.toEngineCarriers(
    [{ id: 'CAR001', name: 'X', cost_per_mile: 1.2, on_time_pct: 98 }],
    { capsByCarrierId: caps }
  ).carriers;

  // Shapes taken from the vendor's own bundled_300k.json.
  const result = { consolidate: { groups: [
    { group_id: 'OK',       carrier_id: 'CAR001', combined_weight_lbs: 41000,  combined_volume_cuft: 3200,  savings: 1200 },
    { group_id: 'SIXLOADS', carrier_id: 'CAR001', combined_weight_lbs: 269887, combined_volume_cuft: 19363, savings: 98000 },
    { group_id: 'EMPTY',    carrier_id: 'CAR001', combined_weight_lbs: 0,      combined_volume_cuft: 0,     savings: 50 },
    { group_id: 'GHOST',    carrier_id: 'NOPE',   combined_weight_lbs: 1000,   combined_volume_cuft: 100,   savings: 10 },
  ] } };

  const v = m.validateConsolidation(result, engineCarriers);
  assert.equal(v.totals.groups_returned, 4);
  assert.equal(v.totals.groups_feasible, 1);
  assert.equal(v.totals.groups_infeasible, 3);
  assert.equal(v.totals.claimed_savings, 99260);
  assert.equal(v.totals.feasible_savings, 1200);
  assert.deepEqual(v.feasible.map((g) => g.group_id), ['OK']);

  const bySix = v.infeasible.find((g) => g.group_id === 'SIXLOADS');
  assert.match(bySix.violations.join(' '), /weight 269887 > cap 45000/);
  assert.match(bySix.violations.join(' '), /volume 19363 > cap 3800/);
  assert.match(v.infeasible.find((g) => g.group_id === 'GHOST').violations.join(' '), /unknown carrier_id/);
});

test('accepts the bare {groups:[]} response shape too', () => {
  const v = m.validateConsolidation({ groups: [] }, []);
  assert.equal(v.totals.groups_returned, 0);
  assert.equal(v.totals.feasible_savings, 0);
});
