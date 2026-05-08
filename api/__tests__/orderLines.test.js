// Tests for services/orderLines.js — pure normalization + rollup used by
// the bulk-plan/import handler (TMS bug #144). No DB hit.
//
// Run with: node --test api/__tests__/orderLines.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLine, buildLines } = require('../services/orderLines');
const { buildOrderLineId } = require('../services/orderLineIds');

// ── normalizeLine ─────────────────────────────────────────────────────

test('normalizeLine: snake_case input — every field maps to its DB column', () => {
  const row = normalizeLine('ORD-100001', {
    line_num:     2,
    item_id:      'ITM-1004',
    description:  'Cisco Catalyst 9300',
    qty_ordered:  10,
    unit_weight:  38,
    total_weight: 380,
  }, 1);
  assert.equal(row.id,           'ORD-100001-L002');
  assert.equal(row.order_id,     'ORD-100001');
  assert.equal(row.line_num,     2);
  assert.equal(row.item_id,      'ITM-1004');
  assert.equal(row.description,  'Cisco Catalyst 9300');
  assert.equal(row.qty_ordered,  10);
  assert.equal(row.unit_weight,  38);
  assert.equal(row.total_weight, 380);
  // unit_value/total_value mirror weights (matches existing inline handler).
  assert.equal(row.unit_value,   38);
  assert.equal(row.total_value,  380);
});

test('normalizeLine: camelCase input (the shape the import parser produces)', () => {
  const row = normalizeLine('ORD-200002', {
    lineNum:     1,
    itemId:      'ITM-2110',
    description: 'SFP-10G-LR',
    qtyOrdered:  40,
    unitWeight:  1,
    totalWeight: 40,
  });
  assert.equal(row.id,           'ORD-200002-L001');
  assert.equal(row.line_num,     1);
  assert.equal(row.item_id,      'ITM-2110');
  assert.equal(row.qty_ordered,  40);
  assert.equal(row.unit_weight,  1);
  assert.equal(row.total_weight, 40);
});

test('normalizeLine: bare-bones legacy keys (qty/unitWt/totalWt) still work', () => {
  // The existing UI editor sends these per server.js:1340-1342.
  const row = normalizeLine('ORD-300003', {
    qty:     5,
    unitWt:  52,
    totalWt: 260,
  }, 7);
  assert.equal(row.line_num,     7);     // fallback used because no lineNum/line_num
  assert.equal(row.qty_ordered,  5);
  assert.equal(row.unit_weight,  52);
  assert.equal(row.total_weight, 260);
});

test('normalizeLine: missing line_num falls back to caller-supplied number', () => {
  const row = normalizeLine('ORD-400004', { description: 'x', qty: 1, unitWt: 1 }, 9);
  assert.equal(row.line_num, 9);
  assert.equal(row.id,       'ORD-400004-L009');
});

test('normalizeLine: line_num zero or invalid falls back, not 0', () => {
  // line_num=0 would produce ORD-…-L000 which the canonical id format
  // assumes is never legal. The fallback prevents that.
  const row = normalizeLine('ORD-500005', { line_num: 0 }, 3);
  assert.equal(row.line_num, 3);
  assert.equal(row.id,       'ORD-500005-L003');
});

test('normalizeLine: missing total_weight is computed as qty * unit', () => {
  const row = normalizeLine('ORD-600006', {
    qtyOrdered: 4, unitWeight: 12.5,
    // no total_weight
  }, 1);
  assert.equal(row.total_weight, 50);   // 4 * 12.5
});

test('normalizeLine: float math does not drift (3 * 1.1 stays 3.3)', () => {
  const row = normalizeLine('ORD-700007', { qty: 3, unitWt: 1.1 }, 1);
  assert.equal(row.total_weight, 3.3);
});

test('normalizeLine: explicit total_weight wins over qty * unit', () => {
  const row = normalizeLine('ORD-800008', {
    qty: 4, unitWt: 12.5, totalWt: 100,  // not 50
  }, 1);
  assert.equal(row.total_weight, 100);
});

test('normalizeLine: zero/missing total_weight + zero qty => 0 (not NaN)', () => {
  const row = normalizeLine('ORD-900009', { description: 'free text only' }, 1);
  assert.equal(row.qty_ordered,  0);
  assert.equal(row.unit_weight,  0);
  assert.equal(row.total_weight, 0);
});

test('normalizeLine: item_id is nullable — empty string normalises to null', () => {
  // The schema is intentionally soft; description can carry the freight
  // identity on its own.
  const row = normalizeLine('ORD-100010', {
    item_id: null, description: 'Pallet wrap', qty: 1, unitWt: 5,
  }, 1);
  assert.equal(row.item_id, null);
});

test('normalizeLine: id format matches buildOrderLineId for line_num 1, 10, 100', () => {
  for (const n of [1, 10, 100]) {
    const row = normalizeLine('ORD-AAA-AAA', { line_num: n }, 1);
    assert.equal(row.id, buildOrderLineId('ORD-AAA-AAA', n));
  }
});

// ── buildLines ────────────────────────────────────────────────────────

test('buildLines: rolls weight + pieces up across all lines', () => {
  const out = buildLines('ORD-100001', [
    { qtyOrdered: 10, unitWeight: 38, totalWeight: 380 },  // Cisco Catalyst
    { qtyOrdered:  5, unitWeight: 52, totalWeight: 260 },  // Cisco Catalyst 9500
    { qtyOrdered: 40, unitWeight:  1, totalWeight:  40 },  // SFPs
  ]);
  assert.equal(out.line_count, 3);
  assert.equal(out.weight,     680);     // 380 + 260 + 40
  assert.equal(out.pieces,     55);      // 10 + 5 + 40
});

test('buildLines: drops fully blank rows (Excel padding)', () => {
  const out = buildLines('ORD-X', [
    { description: 'real', qty: 1, unitWt: 1 },
    null,
    { description: '',  itemId: '',  qty: 0 },           // all-blank → drop
    { description: '   ', itemId: '   ', qty: '' },      // whitespace-blank → drop
    {},                                                   // empty obj → drop
  ]);
  assert.equal(out.line_count, 1);
  assert.equal(out.lines[0].description, 'real');
});

test('buildLines: a row with only item_id is kept (no description, no qty)', () => {
  // Item-master will fill in description on display; the row is still
  // meaningful.
  const out = buildLines('ORD-X', [
    { itemId: 'ITM-1', qty: 0, unitWt: 0 },
  ]);
  assert.equal(out.line_count, 1);
  assert.equal(out.lines[0].item_id, 'ITM-1');
});

test('buildLines: a row with only description is kept', () => {
  const out = buildLines('ORD-X', [
    { description: 'Misc — line note', qty: 0 },
  ]);
  assert.equal(out.line_count, 1);
  assert.equal(out.lines[0].description, 'Misc — line note');
});

test('buildLines: explicit line_num is preserved across dropped blanks', () => {
  // Matches the UI editor's existing POST /api/orders/:id/lines
  // behaviour (server.js:1337 — `line.line_num || (i + 1)`). A sheet
  // that explicitly numbers lines 1/5/9 keeps those numbers; gaps in
  // line_num are legal — `(order_id, line_num)` is the dedupe key,
  // not the contiguity.
  const out = buildLines('ORD-X', [
    { line_num: 1, description: 'a', qty: 1, unitWt: 1 },
    {},                                                              // drop
    { line_num: 5, description: 'b', qty: 1, unitWt: 1 },
    { description: '', itemId: '', qty: 0 },                         // drop
    { line_num: 9, description: 'c', qty: 1, unitWt: 1 },
  ]);
  assert.equal(out.line_count, 3);
  assert.deepEqual(out.lines.map((l) => l.line_num), [1, 5, 9]);
  assert.deepEqual(out.lines.map((l) => l.id), [
    'ORD-X-L001', 'ORD-X-L005', 'ORD-X-L009',
  ]);
});

test('buildLines: missing line_num gets sequential 1..N fallback', () => {
  // The common Line Items-sheet case — user leaves Line # blank.
  const out = buildLines('ORD-Y', [
    { description: 'a', qty: 1, unitWt: 1 },
    { description: 'b', qty: 1, unitWt: 1 },
    { description: 'c', qty: 1, unitWt: 1 },
  ]);
  assert.deepEqual(out.lines.map((l) => l.line_num), [1, 2, 3]);
});

test('buildLines: mixed explicit/missing line_num — explicit wins, fallback fills gaps from position', () => {
  // The position-in-cleaned-batch (i+1) is the fallback, not a
  // resequence — so the missing-lineNum row picks up the position
  // index even if it lands between two explicit numbers.
  const out = buildLines('ORD-Z', [
    { line_num: 10, description: 'a', qty: 1, unitWt: 1 },
    {              description: 'b', qty: 1, unitWt: 1 }, // i=1 → fallback 2
    { line_num: 20, description: 'c', qty: 1, unitWt: 1 },
  ]);
  assert.deepEqual(out.lines.map((l) => l.line_num), [10, 2, 20]);
});

test('buildLines: empty input → zero rollup, no rows', () => {
  for (const input of [[], null, undefined]) {
    const out = buildLines('ORD-X', input);
    assert.equal(out.line_count, 0);
    assert.equal(out.weight,     0);
    assert.equal(out.pieces,     0);
    assert.deepEqual(out.lines,  []);
  }
});

test('buildLines: rollup weight is rounded to 2 decimals (no float drift)', () => {
  // Three lines each contributing 3.3 → 9.9 (not 9.899999999...).
  const out = buildLines('ORD-X', [
    { qty: 3, unitWt: 1.1 },
    { qty: 3, unitWt: 1.1 },
    { qty: 3, unitWt: 1.1 },
  ]);
  assert.equal(out.weight, 9.9);
  assert.equal(out.pieces, 9);
});

test('buildLines: realistic 2-order template payload (mirrors downloadOrderTemplate)', () => {
  // The TEMPLATE_SAMPLE_ROWS in orderImportService.js seed two orders
  // with these line totals. This test pins the rollup math to those
  // values so a future template tweak can't silently change them.
  const orderA = buildLines('ORD-A', [
    { lineNum: 1, itemId: 'ITM-1004', description: 'Cisco Catalyst 9300', qtyOrdered: 10, unitWeight: 38, totalWeight: 380 },
    { lineNum: 2, itemId: 'ITM-1006', description: 'Cisco Catalyst 9500', qtyOrdered:  5, unitWeight: 52, totalWeight: 260 },
    { lineNum: 3, itemId: 'ITM-2110', description: 'SFP-10G-LR',          qtyOrdered: 40, unitWeight:  1, totalWeight:  40 },
  ]);
  assert.equal(orderA.line_count, 3);
  assert.equal(orderA.weight,     680);
  assert.equal(orderA.pieces,     55);

  const orderB = buildLines('ORD-B', [
    { lineNum: 1, itemId: 'ITM-3300', description: 'Office supplies', qtyOrdered: 10, unitWeight: 25, totalWeight: 250 },
    { lineNum: 2, itemId: '',          description: 'Pallet wrap',     qtyOrdered:  5, unitWeight: 10, totalWeight:  50 },
  ]);
  assert.equal(orderB.line_count, 2);
  assert.equal(orderB.weight,     300);
  assert.equal(orderB.pieces,     15);
});
