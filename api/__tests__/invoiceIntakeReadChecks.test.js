'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { check, matchCarrier } = require('../services/invoiceIntake/readChecks');
const { normalize } = require('../services/invoiceIntake/pdfExtractor');

const carriers = ['RIDGELINE FREIGHT', 'BLUEWATER CARRIERS', 'PIONEER EXPRESS'];
const read = (o = {}) => normalize({
  invoiceNumber: 'PE-0931', carrier: 'PIONEER EXPRESS LTL', shipmentRef: 'SHP-40141', total: 442.64, confidence: 0.97,
  lines: [
    { description: 'LTL freight charges', category: 'base', amount: 236 },
    { description: 'Fuel surcharge', category: 'fuel', amount: 56.64 },
    { description: 'Detention 2.0 hrs @ $75.00', category: 'accessorial', accessorialType: 'detention', hours: 2, amount: 150 },
  ],
  ...o,
});

test('good read passes and maps cost types + accessorial type', () => {
  const r = check(read(), { knownCarriers: carriers });
  assert.equal(r.ok, true);
  assert.equal(r.carrier, 'PIONEER EXPRESS');
  assert.deepEqual(r.lines.map((l) => l.cost_type), ['base', 'fuel_surcharge', 'accessorial']);
  assert.equal(r.lines[2].accessorial_type, 'detention');
});

test('lines that do not add up go to a person', () => {
  const r = check(read({ total: 500 }), { knownCarriers: carriers });
  assert.equal(r.ok, false);
  assert.match(r.problems.join(' '), /add up/);
});

test('low confidence goes to a person', () => {
  assert.equal(check(read({ confidence: 0.6 }), { knownCarriers: carriers }).ok, false);
});

test('unknown carrier and missing shipment ref are caught', () => {
  const r = check(read({ carrier: 'Acme Haulers', shipmentRef: null }), { knownCarriers: carriers });
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 2);
});

test('carrier match is first-word, case-insensitive', () => {
  assert.equal(matchCarrier('Bluewater Carriers, Inc.', carriers), 'BLUEWATER CARRIERS');
});
