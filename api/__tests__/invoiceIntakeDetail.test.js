// Review drawer: each invoice line next to what the contract and TMS expect.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const S = (rel) => path.join(__dirname, '..', 'services', rel);
function stub(rel, exports) { const id = require.resolve(S(rel)); require.cache[id] = { id, filename: id, loaded: true, exports }; }
stub('supabase.js', { dbSelect: async () => [] });
stub('agents/freightAudit/index.js', { auditOne: async () => ({}) });
const { compareLines, fieldsOf } = require('../services/invoiceIntake/intakeDetail');

const expected = { base: 1180, fuel: 259.6, fuelSource: 'shipment' };

test('BW-5521: base $100 over contract and fuel $22 over', () => {
  const rows = compareLines({ hasShipment: true, expected, lines: [
    { cost_type: 'base', description: 'Truckload linehaul', invoice_cost: 1280 },
    { cost_type: 'fuel_surcharge', description: 'Fuel (22%)', invoice_cost: 281.6 },
  ] });
  assert.deepEqual(rows.map((r) => [r.status, r.expected, r.difference]), [['over', 1180, 100], ['over', 259.6, 22]]);
});

test('an approved extra matches; an extra with no approval is flagged', () => {
  const approvals = [{ accessorial_type: 'detention', max_hours: 2, rate_per_hour: 75 }];
  const rows = compareLines({ hasShipment: true, expected: { base: 236, fuel: 56.64 }, approvals, lines: [
    { cost_type: 'accessorial', accessorial_type: 'detention', description: 'Detention 2.0 hrs', invoice_cost: 150 },
    { cost_type: 'accessorial', accessorial_type: 'liftgate', description: 'Liftgate', invoice_cost: 85 },
  ] });
  assert.deepEqual(rows.map((r) => [r.status, r.expected]), [['match', 150], ['not_approved', 0]]);
});

test('no shipment in the TMS: nothing to compare against', () => {
  const rows = compareLines({ hasShipment: false, expected: null, lines: [{ cost_type: 'base', invoice_cost: 1180 }] });
  assert.equal(rows[0].status, 'no_reference');
  assert.equal(rows[0].expected, null);
});

test('fields come from what was read, empty ones are left out', () => {
  const f = fieldsOf({ invoice_number: 'X', raw_extraction: { invoiceNumber: 'BW-5521', carrier: 'Bluewater', total: 1561.6, proNumber: '' } });
  assert.deepEqual(f.map((x) => x.label), ['Invoice number', 'Carrier', 'Total']);
});

test('each field carries the agent confidence for it when the read has one', () => {
  const f = fieldsOf({ raw_extraction: { invoiceNumber: 'BW-5521', total: 1561.6, fieldConfidence: { invoiceNumber: 0.99, total: 0.62 } } });
  assert.deepEqual(f.map((x) => [x.key, x.confidence]), [['invoiceNumber', 0.99], ['total', 0.62]]);
});
