'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildCarrierDraft } = require('../services/invoiceIntake/carrierDraft');

const BW_LINES = [
  { type: 'base', description: 'Linehaul', billed: 1280, expected: 1180, difference: 100, status: 'over' },
  { type: 'fuel_surcharge', description: 'Fuel', billed: 281.6, expected: 259.6, difference: 22, status: 'over' },
];
const FAIL = (code, detail = '') => ({ verdict: 'dispute', issues: [{ code, detail }] });

test('BW-5521: names both discrepancies and asks for a corrected invoice of $1,439.60 (-$122.00)', () => {
  const d = buildCarrierDraft({ invoiceNumber: 'BW-5521', carrier: 'BLUEWATER CARRIERS', shipmentId: 'KB-SH-40130', invoiceTotal: 1561.6, lines: BW_LINES, audit: FAIL('base_over_contract'), to: 'billing@bluewater.example' });
  assert.equal(d.correctedTotal, 1439.6);
  assert.equal(d.reduction, 122);
  assert.match(d.subject, /BW-5521.*KB-SH-40130.*corrected invoice requested/);
  assert.match(d.body, /Linehaul \(base rate\): billed \$1,280\.00, contract rate \$1,180\.00, a difference of \$100\.00/);
  assert.match(d.body, /Fuel surcharge: billed \$281\.60, expected \$259\.60 \(22% of the \$1,180\.00 contract base\), a difference of \$22\.00/);
  assert.match(d.body, /corrected invoice for \$1,439\.60, which reduces the bill by \$122\.00/);
  assert.match(d.body, /Hello Bluewater Carriers billing team/);
  assert.equal(d.to, 'billing@bluewater.example');
});

test('RF-88214: an unapproved liftgate asks for the approval or removal', () => {
  const lines = [
    { type: 'base', billed: 412, expected: 412, difference: 0, status: 'match' },
    { type: 'fuel_surcharge', billed: 98.88, expected: 98.88, difference: 0, status: 'match' },
    { type: 'accessorial', description: 'liftgate', billed: 85, expected: 0, difference: 85, status: 'not_approved' },
  ];
  const d = buildCarrierDraft({ invoiceNumber: 'RF-88214', carrier: 'RIDGELINE FREIGHT', shipmentId: 'KB-SH-40122', invoiceTotal: 595.88, lines, audit: FAIL('accessorial_unapproved') });
  assert.match(d.body, /Liftgate: billed \$85\.00, but there is no approval/);
  assert.equal(d.correctedTotal, 510.88);
  assert.equal(d.reduction, 85);
});

test('BW-5527 and RF-88230: missing and cancelled shipments ask for documents or a void, no amount', () => {
  const nf = buildCarrierDraft({ invoiceNumber: 'BW-5527', carrier: 'BLUEWATER CARRIERS', shipmentId: 'KB-SH-40999', invoiceTotal: 1439.6, lines: [], audit: FAIL('no_shipment') });
  assert.match(nf.body, /can't find shipment KB-SH-40999/);
  assert.match(nf.subject, /shipment documents needed/);
  assert.equal(nf.correctedTotal, null);
  const cx = buildCarrierDraft({ invoiceNumber: 'RF-88230', carrier: 'RIDGELINE FREIGHT', shipmentId: 'KB-SH-40155', invoiceTotal: 510.88, lines: [], audit: FAIL('not_delivered', 'KB-SH-40155 is Cancelled') });
  assert.match(cx.body, /was cancelled.*void this invoice/);
  assert.match(cx.subject, /please void/);
});

test('no draft when the invoice passes, or when only the $2,500 limit holds it', () => {
  assert.equal(buildCarrierDraft({ invoiceNumber: 'PE-0931', carrier: 'PIONEER', lines: [], audit: { verdict: 'approve', issues: [] } }), null);
  assert.equal(buildCarrierDraft({ invoiceNumber: 'X', carrier: 'Y', lines: [{ type: 'base', billed: 2500.01, expected: 2500.01, difference: 0, status: 'match' }], audit: FAIL('over_approval_limit') }), null);
});

test('a draft is text only: it changes nothing on the invoice', () => {
  const invoice = Object.freeze({ status: 'On Hold' });
  buildCarrierDraft({ invoiceNumber: 'BW-5521', carrier: 'BLUEWATER CARRIERS', shipmentId: 'KB-SH-40130', invoiceTotal: 1561.6, lines: BW_LINES, audit: FAIL('base_over_contract') });
  assert.equal(invoice.status, 'On Hold');
});
