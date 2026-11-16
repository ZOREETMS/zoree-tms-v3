import test from 'node:test';
import assert from 'node:assert';

// Mirrors partitionForDelete in frontend/src/services/bulkDeleteService.js.
// Duplicated because that module is browser-side ESM; the refusal rule is
// the safety-critical part and it is pure.
const PROTECTED = ["Tendered", "Tender Accepted", "Shipped", "In Transit", "Delivered"];

function partitionForDelete(orders, selectedIds) {
  const ids = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  const deletable = [], blocked = [];
  for (const o of orders || []) {
    if (!o || !ids.has(o.id)) continue;
    if (PROTECTED.includes(o.status)) blocked.push(o); else deletable.push(o);
  }
  return { deletable, blocked };
}

const o = (id, status) => ({ id, status });

test('deletes only what was explicitly selected', () => {
  const rows = [o('A', 'Unplanned'), o('B', 'Unplanned'), o('C', 'Unplanned')];
  const { deletable } = partitionForDelete(rows, new Set(['A', 'C']));
  assert.deepEqual(deletable.map((x) => x.id), ['A', 'C'], 'B was not selected and must survive');
});

test('refuses every committed status', () => {
  const rows = PROTECTED.map((s, i) => o(`P${i}`, s));
  const { deletable, blocked } = partitionForDelete(rows, new Set(rows.map((r) => r.id)));
  assert.deepEqual(deletable, [], 'freight committed to a carrier must never be deleted');
  assert.equal(blocked.length, PROTECTED.length);
});

test('planned and cancelled orders are deletable', () => {
  const rows = [o('A', 'Planned'), o('B', 'Consolidated'), o('C', 'Planning Failed'), o('D', 'Cancelled')];
  const { deletable } = partitionForDelete(rows, new Set(['A', 'B', 'C', 'D']));
  assert.equal(deletable.length, 4);
});

test('a mixed selection splits rather than failing whole', () => {
  const rows = [o('A', 'Unplanned'), o('B', 'In Transit'), o('C', 'Planned')];
  const { deletable, blocked } = partitionForDelete(rows, new Set(['A', 'B', 'C']));
  assert.deepEqual(deletable.map((x) => x.id), ['A', 'C']);
  assert.deepEqual(blocked.map((x) => x.id), ['B']);
});

test('accepts an array of ids as well as a Set', () => {
  const rows = [o('A', 'Unplanned')];
  assert.equal(partitionForDelete(rows, ['A']).deletable.length, 1);
});

test('empty selection deletes nothing', () => {
  const rows = [o('A', 'Unplanned'), o('B', 'Planned')];
  assert.deepEqual(partitionForDelete(rows, new Set()).deletable, []);
  assert.deepEqual(partitionForDelete(rows, null).deletable, []);
});

test('junk rows are skipped', () => {
  const rows = [null, undefined, {}, o('A', 'Unplanned')];
  assert.deepEqual(partitionForDelete(rows, new Set(['A'])).deletable.map((x) => x.id), ['A']);
});
