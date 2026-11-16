// Intake log: the AP outcome of each document and the summary counts.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { outcomeOf, summarize, riskOf, queueStats, shortReasonOf, _internals: { entry } } = require('../services/invoiceIntake/intakeLog');

test('a created invoice is ready to post once approved, disputed once AP disputes or rejects it', () => {
  assert.equal(outcomeOf({ status: 'created', invoice_id: 'I1' }, { status: 'Approved', sent_to_ap_at: '2026-11-14T00:00:00Z' }), 'ready_to_post');
  assert.equal(outcomeOf({ status: 'created', invoice_id: 'I1' }, { status: 'Disputed' }), 'disputed');
  assert.equal(outcomeOf({ status: 'created', invoice_id: 'I1' }, { status: 'Rejected' }), 'disputed');
  assert.equal(outcomeOf({ status: 'created', invoice_id: 'I1' }, { status: 'On Hold', sent_to_ap_at: null }), 'needs_review');
  assert.equal(outcomeOf({ status: 'created', invoice_id: 'I1' }, undefined), 'needs_review');
});

test('an invoice deleted after it was created shows as deleted, not needs review', () => {
  assert.equal(outcomeOf({ status: 'created', invoice_id: null }, undefined), 'deleted');
});

test('documents that never became an invoice keep their own outcome', () => {
  assert.equal(outcomeOf({ status: 'duplicate' }), 'duplicate');
  assert.equal(outcomeOf({ status: 'needs_manual' }), 'needs_manual');
  assert.equal(outcomeOf({ status: 'failed' }), 'failed');
});

test('the reason is the agent finding; a later AP approval is shown with it', () => {
  const held = entry({ id: 'a', status: 'created', invoice_id: 'I1', outcome_reason: 'Needs AP review: Liftgate not approved', total: 10 }, { status: 'On Hold', decision_reason: '[Zoree AI] x' });
  assert.equal(held.outcome, 'needs_review');
  assert.equal(held.reason, 'Needs AP review: Liftgate not approved');
  const clean = entry({ id: 'b', status: 'created', invoice_id: 'I2', outcome_reason: 'Ready to post', total: 10 }, { status: 'Approved', sent_to_ap_at: 'x', decision_reason: 'Within tolerance' });
  assert.equal(clean.reason, 'Ready to post');
  const overridden = entry({ id: 'c', status: 'created', invoice_id: 'I3', outcome_reason: 'Needs AP review: Liftgate not approved', total: 10 }, { status: 'Approved', sent_to_ap_at: 'x', decision_reason: 'Carrier sent the approval', decided_by: 'ap@x.com' });
  assert.equal(overridden.outcome, 'ready_to_post');
  assert.match(overridden.reason, /^Approved by AP \(ap@x\.com\): Carrier sent the approval\. Agent finding: Needs AP review/);
});

test('summary counts and dollars per outcome', () => {
  const s = summarize([
    { outcome: 'ready_to_post', total: 510.88 }, { outcome: 'ready_to_post', total: 510.88 }, { outcome: 'ready_to_post', total: 442.64 },
    { outcome: 'needs_review', total: 595.88 }, { outcome: 'needs_review', total: 1561.6 }, { outcome: 'needs_review', total: 1439.6 }, { outcome: 'needs_review', total: 510.88 },
    { outcome: 'duplicate', total: 510.88 },
  ]);
  assert.equal(s.received, 8);
  assert.equal(s.receivedTotal, 6083.24);
  assert.equal(s.avgConfidence, null);
  assert.deepEqual(s.ready_to_post, { count: 3, total: 1464.4 });
  assert.deepEqual(s.needs_review, { count: 4, total: 4107.96 });
  assert.deepEqual(s.duplicate, { count: 1, total: 510.88 });
});

test('risk for the approval queue comes from structured facts, not text', () => {
  const ship = { id: 'S1', status: 'Delivered' };
  assert.equal(riskOf({ invoice: { metadata: { intake: { sender_verification: 'unverified' } } }, shipment: ship }), 'critical');
  assert.equal(riskOf({ invoice: { metadata: { missing_shipments: ['S9'] } }, shipment: null }), 'high');
  assert.equal(riskOf({ invoice: { metadata: {} }, shipment: { id: 'S1', status: 'Cancelled' } }), 'high');
  assert.equal(riskOf({ invoice: { metadata: {}, variance: 122 }, shipment: ship }), 'medium');
  assert.equal(riskOf({ invoice: { metadata: {}, variance: 0 }, shipment: ship }), 'low');
});

test('queue stats count only decisions made by a person', () => {
  const now = Date.parse('2026-11-14T20:00:00Z');
  const inv = [
    { status: 'Approved', decided_by: 'ap@x.com', created_at: '2026-11-14T19:00:00Z', decided_at: '2026-11-14T19:10:00Z' },
    { status: 'Disputed', decided_by: 'ap@x.com', created_at: '2026-11-14T19:00:00Z', decided_at: '2026-11-14T19:30:00Z' },
    { status: 'Approved', decided_by: 'invoice-intake-agent', created_at: '2026-11-14T19:00:00Z', decided_at: '2026-11-14T19:00:05Z' },
    { status: 'Approved', decided_by: 'ap@x.com', created_at: '2026-10-01T00:00:00Z', decided_at: '2026-10-01T00:20:00Z' },
  ];
  const q = queueStats([{ outcome: 'needs_review' }, { outcome: 'ready_to_post' }], inv, now);
  assert.deepEqual(q, { pending: 1, approved7d: 1, disputed7d: 1, reviewers: 1, avgReviewMinutes: 20 });
});

test('short exception reasons for the list', () => {
  const ship = { id: 'S1', status: 'Delivered' };
  const held = (inv, extra = {}) => shortReasonOf({ row: { outcome_reason: 'Needs AP review: x', ...extra }, invoice: { metadata: {}, ...inv }, shipment: ship, outcome: 'needs_review' });
  assert.equal(held({ variance: 122 }), 'Over contract $122.00');
  assert.equal(held({ variance: 85, decision_reason: 'Extra charges billed $85.00 (Liftgate)' }), 'Unapproved extra $85.00');
  assert.equal(shortReasonOf({ row: {}, invoice: { metadata: { missing_shipments: ['X'] } }, shipment: null, outcome: 'needs_review' }), 'Shipment not in TMS');
  assert.equal(shortReasonOf({ row: {}, invoice: { metadata: {} }, shipment: { status: 'Cancelled' }, outcome: 'needs_review' }), 'Shipment cancelled');
  assert.equal(shortReasonOf({ row: { invoice_number: 'RF-1' }, outcome: 'duplicate' }), 'Resend of RF-1');
});

test('a clean invoice names the approved extras it carried', () => {
  const ready = (extras) => shortReasonOf({ row: { outcome_reason: 'Ready to post' }, invoice: { metadata: {} }, shipment: { status: 'Delivered' }, outcome: 'ready_to_post', extras });
  assert.equal(ready([]), 'Contract matched');
  assert.equal(ready([{ type: 'detention', amount: 150 }]), 'Contract matched; $150.00 detention approved');
});
