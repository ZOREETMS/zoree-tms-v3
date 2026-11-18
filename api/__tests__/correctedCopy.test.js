'use strict';

// Same carrier + same invoice number: duplicate, corrected revision, or a person.
const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, chargeChanges } = require('../services/invoiceIntake/revisionClassifier');

const lines = (linehaul, detention) => [
  { cost_type: 'linehaul', invoice_cost: linehaul },
  ...(detention != null ? [{ cost_type: 'accessorial', accessorial_type: 'detention', invoice_cost: detention }] : []),
];
const orig = (over = {}) => ({ id: 'INV-1', invoice_number: 'BW-5521', carrier: 'BLUEWATER', status: 'Disputed', invoiced_amount: '1561.60',
  shipment_id: 'KB-SH-1', received_at: '2026-11-17T10:00:00Z', lines: lines(1180, 381.6), ...over });
const incoming = (over = {}) => ({ total: 1439.6, shipmentId: 'KB-SH-1', lines: lines(1180, 259.6), ...over });

test('nothing on file: new invoice', () => {
  assert.equal(classify([], incoming()).kind, 'new');
});

test('exact resubmission stays a duplicate, whatever the original status', () => {
  for (const status of ['Disputed', 'On Hold', 'Pending', 'Approved', 'Paid', 'Rejected', 'Superseded']) {
    const r = classify([orig({ status })], incoming({ total: 1561.6, lines: lines(1180, 381.6) }));
    assert.equal(r.kind, 'duplicate', status);
    assert.equal(r.target.id, 'INV-1');
  }
});

test('disputed or held original + changed amount = corrected revision linked to it', () => {
  for (const status of ['Disputed', 'On Hold', 'Pending']) {
    const r = classify([orig({ status })], incoming());
    assert.equal(r.kind, 'revision', status);
    assert.equal(r.target.id, 'INV-1');
    assert.match(r.changes, /total \$1561\.60 → \$1439\.60/);
    assert.match(r.changes, /detention \$381\.60 → \$259\.60/);
  }
});

test('same total but different charges is still a revision', () => {
  const r = classify([orig()], incoming({ total: 1561.6, lines: lines(1300, 261.6) }));
  assert.equal(r.kind, 'revision');
  assert.match(r.changes, /linehaul \$1180\.00 → \$1300\.00/);
});

test('approved or paid original is never replaced: credit/adjustment for a person', () => {
  for (const status of ['Approved', 'Paid']) {
    const r = classify([orig({ status })], incoming());
    assert.equal(r.kind, 'adjustment', status);
    assert.match(r.reason, /credit or adjustment/);
  }
});

test('different shipment under the same number goes to a person', () => {
  const r = classify([orig()], incoming({ shipmentId: 'KB-SH-9' }));
  assert.equal(r.kind, 'needs_person');
  assert.match(r.reason, /different load/);
});

test('rejected or only-closed originals go to a person', () => {
  assert.equal(classify([orig({ status: 'Rejected' })], incoming()).kind, 'needs_person');
  assert.equal(classify([orig({ status: 'Cancelled' })], incoming()).kind, 'needs_person');
});

test('only the latest version is corrected: a revision of a revision', () => {
  const v1 = orig({ status: 'Superseded' });
  const v2 = orig({ id: 'INV-2', status: 'On Hold', invoiced_amount: '1500.00', received_at: '2026-11-17T11:00:00Z', lines: lines(1180, 320) });
  const r = classify([v1, v2], incoming());
  assert.equal(r.kind, 'revision');
  assert.equal(r.target.id, 'INV-2');
  // The latest is already approved: the next change is an adjustment, not a third payable copy.
  assert.equal(classify([v1, { ...v2, status: 'Approved' }], incoming()).kind, 'adjustment');
});

test('re-sending the superseded original is a duplicate of it, not a revert', () => {
  const v1 = orig({ status: 'Superseded' });
  const v2 = orig({ id: 'INV-2', status: 'On Hold', invoiced_amount: '1439.60', received_at: '2026-11-17T11:00:00Z', lines: lines(1180, 259.6) });
  const r = classify([v1, v2], incoming({ total: 1561.6, lines: lines(1180, 381.6) }));
  assert.equal(r.kind, 'duplicate');
  assert.equal(r.target.id, 'INV-1');
});

test('charge comparison ignores line order and lists added/removed charges', () => {
  assert.equal(chargeChanges(lines(1180, 259.6), [...lines(1180, 259.6)].reverse()), '');
  assert.match(chargeChanges(lines(1180), lines(1180, 100)), /added detention \$100\.00/);
  assert.match(chargeChanges(lines(1180, 100), lines(1180)), /removed detention/);
});
