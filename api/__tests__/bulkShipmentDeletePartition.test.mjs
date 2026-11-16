import test from 'node:test';
import assert from 'node:assert';

// Mirrors partitionShipmentsForDelete in
// frontend/src/services/bulkShipmentDeleteService.js. Duplicated because that
// module is browser-side ESM; the refusal rule is the safety-critical part
// and it is pure.
const PROTECTED = ["Tendered", "Tender Accepted", "Shipped", "In Transit", "Delivered"];

function statusOf(row) {
  return row?._displayStatus || row?.status || "";
}

function partitionShipmentsForDelete(rows, selectedIds) {
  const ids = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  const deletable = [], blocked = [];
  for (const s of rows || []) {
    if (!s || !ids.has(s.id)) continue;
    if (PROTECTED.includes(statusOf(s))) blocked.push(s); else deletable.push(s);
  }
  return { deletable, blocked };
}

const s = (id, status, extra = {}) => ({ id, status, ...extra });

test('deletes only what was explicitly selected', () => {
  const rows = [s('S1', 'Planned'), s('S2', 'Planned'), s('S3', 'Planned')];
  const { deletable } = partitionShipmentsForDelete(rows, new Set(['S1', 'S3']));
  assert.deepEqual(deletable.map((x) => x.id), ['S1', 'S3'], 'S2 was not selected and must survive');
});

test('refuses every committed status', () => {
  const rows = PROTECTED.map((st, i) => s(`P${i}`, st));
  const { deletable, blocked } = partitionShipmentsForDelete(rows, new Set(rows.map((r) => r.id)));
  assert.deepEqual(deletable, [], 'freight committed to a carrier must never be bulk-deleted');
  assert.equal(blocked.length, PROTECTED.length);
});

test('_displayStatus wins over the raw status column', () => {
  // effectiveShipmentStatus normalises Tendered + accept-note to Tender
  // Accepted; the raw row still says "Tendered"/"Confirmed". The refusal
  // must read the effective one.
  const rows = [s('S1', 'Confirmed', { _displayStatus: 'Tender Accepted' })];
  const { deletable, blocked } = partitionShipmentsForDelete(rows, new Set(['S1']));
  assert.equal(deletable.length, 0);
  assert.equal(blocked.length, 1);
});

test('planned, open and cancelled shipments are deletable', () => {
  const rows = [s('A', 'Planned'), s('B', 'Open'), s('C', 'Cancelled'), s('D', '')];
  const { deletable } = partitionShipmentsForDelete(rows, new Set(['A', 'B', 'C', 'D']));
  assert.equal(deletable.length, 4);
});

test('a mixed selection splits rather than failing whole', () => {
  const rows = [s('A', 'Planned'), s('B', 'In Transit'), s('C', 'Planned')];
  const { deletable, blocked } = partitionShipmentsForDelete(rows, new Set(['A', 'B', 'C']));
  assert.deepEqual(deletable.map((x) => x.id), ['A', 'C']);
  assert.deepEqual(blocked.map((x) => x.id), ['B']);
});

test('empty and missing selections delete nothing', () => {
  const rows = [s('A', 'Planned')];
  assert.equal(partitionShipmentsForDelete(rows, new Set()).deletable.length, 0);
  assert.equal(partitionShipmentsForDelete(rows, undefined).deletable.length, 0);
  assert.equal(partitionShipmentsForDelete(undefined, new Set(['A'])).deletable.length, 0);
});

test('an id selected but absent from rows is ignored, not fabricated', () => {
  const rows = [s('A', 'Planned')];
  const { deletable } = partitionShipmentsForDelete(rows, new Set(['A', 'GHOST']));
  assert.deepEqual(deletable.map((x) => x.id), ['A']);
});
