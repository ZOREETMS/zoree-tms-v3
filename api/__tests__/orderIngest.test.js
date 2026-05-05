// Regression tests for TMS bug #66 (OMS → TMS service-level mapping).
//
// Run with: node --test api/__tests__/orderIngest.test.js
//
// Tests the pure mapping function omsPayloadToDbRow — no DB hit. The
// validator is also covered for completeness so a payload missing
// required fields fails fast before reaching the DB.

const test = require('node:test');
const assert = require('node:assert/strict');
const { omsPayloadToDbRow, validateOmsOrder } = require('../services/orderIngest');

test('omsPayloadToDbRow normalises OMS priority="Expedite" → service_level="Expedited" (bug #66)', () => {
  const row = omsPayloadToDbRow({
    id:       'ORD-915877',
    customer: 'ACME',
    origin:   'Chicago, IL',
    destination: 'Dallas, TX',
    weight:   1500,
    pieces:   8,
    priority: 'Expedite',  // OMS-legacy field name
  });
  assert.equal(row.service_level, 'Expedited');
});

test('omsPayloadToDbRow accepts OMS Priority casing variants', () => {
  for (const v of ['expedite', 'EXPEDITE', '  Expedite  ', 'Expedited', 'EXP']) {
    const row = omsPayloadToDbRow({
      id: 'ORD-1', customer: 'X', origin: 'A', destination: 'B', weight: 100, priority: v,
    });
    assert.equal(row.service_level, 'Expedited', `Failed for input ${JSON.stringify(v)}`);
  }
});

test('omsPayloadToDbRow honours explicit serviceLevel over priority', () => {
  // An OMS row that already speaks the new vocabulary takes priority.
  const row = omsPayloadToDbRow({
    id: 'ORD-2', customer: 'X', origin: 'A', destination: 'B', weight: 100,
    serviceLevel: 'Economy',
    priority:     'Expedite',  // would normally win, but only when serviceLevel is empty
  });
  assert.equal(row.service_level, 'Economy');
});

test('omsPayloadToDbRow stamps OMS audit columns', () => {
  const row = omsPayloadToDbRow({
    id: 'ORD-3', customer: 'X', origin: 'A', destination: 'B', weight: 100,
  });
  assert.equal(row.sync_source, 'oms');
  assert.ok(row.auto_synced_at, 'auto_synced_at must be set');
  assert.equal(row.id, 'ORD-3');
  assert.equal(row.oms_order_ref, 'ORD-3');
});

test('omsPayloadToDbRow drops empty/undefined optional fields (no phantom NULL writes)', () => {
  const row = omsPayloadToDbRow({
    id: 'ORD-4', customer: 'X', origin: 'A', destination: 'B', weight: 100,
    // no service_level, no priority
  });
  // service_level should be absent (setIf skips empty values), not null.
  assert.equal('service_level' in row, false);
});

test('omsPayloadToDbRow forwards Reference # / PO Number variants', () => {
  const row = omsPayloadToDbRow({
    id: 'ORD-5', customer: 'X', origin: 'A', destination: 'B', weight: 100,
    poNumber: '4500-99',
  });
  assert.equal(row.po_number, '4500-99');
});

test('validateOmsOrder rejects payloads missing required fields', () => {
  assert.deepEqual(validateOmsOrder({}, 0), [
    'orders[0].customer is required',
    'orders[0].origin is required',
    'orders[0].destination is required',
    'orders[0].weight must be > 0',
  ]);
});

test('validateOmsOrder accepts a well-formed OMS payload', () => {
  assert.deepEqual(
    validateOmsOrder({ customer: 'X', origin: 'A', destination: 'B', weight: 100 }, 0),
    [],
  );
});
