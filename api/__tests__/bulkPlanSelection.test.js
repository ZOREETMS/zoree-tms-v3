'use strict';

// "Plan with Jev" selection rules: ID cleaning, plannable-only, single lane.

const test = require('node:test');
const assert = require('node:assert');
const { cleanOrderIds, resolveSelection, SelectionError, MAX_SELECTED, cityOf } = require('../services/ai/bulkPlanSelection');

const row = (id, over = {}) => ({ id, status: 'Unplanned', origin: 'COLLEGE PARK, GA 30337', dest: 'DALLAS, TX 75207', weight: '12000', due: '2026-10-10', ...over });

test('cleanOrderIds: null/empty means default lane', () => {
  assert.strictEqual(cleanOrderIds(undefined), null);
  assert.strictEqual(cleanOrderIds(''), null);
  assert.strictEqual(cleanOrderIds([]), null);
  assert.strictEqual(cleanOrderIds([' ', '']), null);
});

test('cleanOrderIds: trims, de-duplicates, accepts comma string', () => {
  assert.deepStrictEqual(cleanOrderIds([' ORD-1 ', 'ORD-2', 'ORD-1']), ['ORD-1', 'ORD-2']);
  assert.deepStrictEqual(cleanOrderIds('ORD-1, ORD-2,,ORD-1'), ['ORD-1', 'ORD-2']);
});

test('cleanOrderIds: rejects more than the cap with a 400', () => {
  const ids = Array.from({ length: MAX_SELECTED + 1 }, (_, i) => `ORD-${i}`);
  assert.throws(() => cleanOrderIds(ids), (e) => e instanceof SelectionError && e.status === 400);
});

test('resolveSelection: single lane, sorted by due, weights numeric', () => {
  const r = resolveSelection(['A', 'B'], [row('A', { due: '2026-10-12' }), row('B', { due: '2026-10-09' })]);
  assert.strictEqual(r.groups.length, 1);
  const g = r.groups[0];
  assert.deepStrictEqual(g.orders.map((o) => o.id), ['B', 'A']);
  assert.strictEqual(g.orders[0].weight, 12000);
  assert.strictEqual(g.origin, 'COLLEGE PARK, GA 30337');
  assert.strictEqual(g.dest, 'DALLAS, TX 75207');
  assert.deepStrictEqual(r.skipped, []);
});

test('resolveSelection: lane comparison ignores case and spacing', () => {
  const r = resolveSelection(['A', 'B'], [row('A'), row('B', { origin: 'college park,  ga 30337 ' })]);
  assert.strictEqual(r.groups.length, 1);
  assert.strictEqual(r.groups[0].orders.length, 2);
});

test('resolveSelection: skips missing, non-plannable, weightless orders with a reason', () => {
  const r = resolveSelection(['A', 'B', 'C', 'D', 'E'], [
    row('A'), row('B', { status: 'Tendered' }), row('C', { weight: 0 }), row('E', { status: 'Planning Failed' }),
  ]);
  assert.deepStrictEqual(r.groups[0].orders.map((o) => o.id), ['A', 'E']);
  assert.deepStrictEqual(r.skipped.map((s) => s.id), ['B', 'C', 'D']);
  assert.match(r.skipped[0].reason, /Tendered/);
  assert.match(r.skipped[2].reason, /not found/i);
});

test('resolveSelection: nothing plannable is a 400', () => {
  assert.throws(() => resolveSelection(['A'], [row('A', { status: 'Delivered' })]),
    (e) => e instanceof SelectionError && e.status === 400 && /A \(/.test(e.message));
});

test('resolveSelection: more than one lane becomes one group per lane, largest first', () => {
  const r = resolveSelection(['A', 'B', 'C'], [row('A', { dest: 'HOUSTON, TX 77001' }), row('B'), row('C')]);
  assert.strictEqual(r.groups.length, 2);
  assert.deepStrictEqual(r.groups[0].orders.map((o) => o.id), ['B', 'C']);
  assert.strictEqual(r.groups[0].dest, 'DALLAS, TX 75207');
  assert.deepStrictEqual(r.groups[1].orders.map((o) => o.id), ['A']);
  assert.strictEqual(r.groups[1].dest, 'HOUSTON, TX 77001');
});

test('cityOf: text before the first comma', () => {
  assert.strictEqual(cityOf('COLLEGE PARK, GA 30337'), 'COLLEGE PARK');
  assert.strictEqual(cityOf(null), '');
});
