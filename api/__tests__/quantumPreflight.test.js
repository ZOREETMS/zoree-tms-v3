const test = require('node:test');
const assert = require('node:assert');
const { preflightOrders, RULES, COMMITTED_STATUSES } = require('../services/quantumPreflight');

const o = (id, extra = {}) => ({ id, status: 'Unplanned', ...extra });

test('a clean unplanned order is eligible', () => {
  const { eligible, excluded } = preflightOrders([o('A')]);
  assert.equal(eligible.length, 1);
  assert.equal(excluded.length, 0);
});

test('no_consolidate never reaches the engine', () => {
  // The engine has no field for this and silently ignores extras, so an
  // order that must ship alone would be bundled without any signal.
  const { eligible, excluded } = preflightOrders([o('A', { no_consolidate: true })]);
  assert.equal(eligible.length, 0);
  assert.equal(excluded[0].code, 'no_consolidate');
});

test('dedicated equipment and hazmat are excluded', () => {
  const { eligible, excluded } = preflightOrders([
    o('A', { dedicated_equip: true }),
    o('B', { hazmat: true }),
  ]);
  assert.equal(eligible.length, 0);
  assert.deepEqual(excluded.map((e) => e.code).sort(), ['dedicated_equip', 'hazmat']);
});

test('carrier preferences are excluded because the engine cannot honour them', () => {
  const { excluded } = preflightOrders([
    o('A', { preferred_carrier: 'CAR001' }),
    o('B', { excluded_carrier: 'CAR002' }),
  ]);
  assert.deepEqual(excluded.map((e) => e.code).sort(), ['excluded_carrier', 'preferred_carrier']);
});

test('every committed status is excluded', () => {
  const rows = COMMITTED_STATUSES.map((s, i) => o(`C${i}`, { status: s }));
  const { eligible, excluded } = preflightOrders(rows);
  assert.equal(eligible.length, 0, 'freight past Tendered must never be re-planned by a batch job');
  assert.equal(excluded.length, COMMITTED_STATUSES.length);
});

test('an order already on a shipment is excluded', () => {
  const { eligible, excluded } = preflightOrders([o('A', { shipment_id: 'SHP-1' })]);
  assert.equal(eligible.length, 0);
  assert.equal(excluded[0].code, 'already_planned');
});

test('--allow opts a rule out without disabling the rest', () => {
  const rows = [o('A', { preferred_carrier: 'CAR001' }), o('B', { hazmat: true })];
  const { eligible, excluded } = preflightOrders(rows, { allow: ['preferred_carrier'] });
  assert.deepEqual(eligible.map((e) => e.id), ['A']);
  assert.deepEqual(excluded.map((e) => e.code), ['hazmat']);
});

test('the most specific reason is reported when several rules trip', () => {
  const { excluded } = preflightOrders([o('A', { shipment_id: 'SHP-1', hazmat: true, no_consolidate: true })]);
  assert.equal(excluded.length, 1, 'one order yields exactly one exclusion');
  assert.equal(excluded[0].code, 'already_planned');
});

test('counts tally per rule for the run report', () => {
  const rows = [o('A', { hazmat: true }), o('B', { hazmat: true }), o('C', { no_consolidate: true }), o('D')];
  const { counts, eligible } = preflightOrders(rows);
  assert.deepEqual(counts, { hazmat: 2, no_consolidate: 1 });
  assert.equal(eligible.length, 1);
});

test('junk rows are dropped without throwing', () => {
  const { eligible, excluded } = preflightOrders([null, undefined, {}, { id: '' }, o('A')]);
  assert.deepEqual(eligible.map((e) => e.id), ['A']);
  assert.equal(excluded.length, 0);
});

test('empty and missing input is safe', () => {
  assert.equal(preflightOrders([]).eligible.length, 0);
  assert.equal(preflightOrders(undefined).eligible.length, 0);
});

test('every rule carries a code and a human reason', () => {
  for (const r of RULES) {
    assert.ok(r.code && typeof r.code === 'string');
    assert.ok(r.describe && r.describe.length > 10, `rule ${r.code} needs a usable explanation`);
    assert.equal(typeof r.test, 'function');
  }
});
