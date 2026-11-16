'use strict';
// The drawer must not show a stale finding as current once today's data passes.
const test = require('node:test');
const assert = require('node:assert');
const { recheckOf } = require('../services/invoiceIntake/intakeDetail');

const held = { status: 'On Hold', decision_reason: '[Zoree AI · Invoice intake] Needs AP review: $85.00 liftgate not approved.' };

test('held invoice that now passes: note + original finding kept', () => {
  const r = recheckOf({ invoice: held, audit: { verdict: 'approve' } });
  assert.ok(r && r.passes);
  assert.match(r.note, /until a person approves/);
  assert.strictEqual(r.originalFinding, 'Needs AP review: $85.00 liftgate not approved.');
});

test('over the limit still says a person must approve', () => {
  assert.match(recheckOf({ invoice: held, audit: { verdict: 'review' } }).note, /over the auto-approve limit/);
});

test('still failing, approved, or no audit: no recheck note', () => {
  assert.strictEqual(recheckOf({ invoice: held, audit: { verdict: 'dispute' } }), null);
  assert.strictEqual(recheckOf({ invoice: { ...held, status: 'Approved' }, audit: { verdict: 'approve' } }), null);
  assert.strictEqual(recheckOf({ invoice: held, audit: null }), null);
  assert.strictEqual(recheckOf({ invoice: null, audit: { verdict: 'approve' } }), null);
});
