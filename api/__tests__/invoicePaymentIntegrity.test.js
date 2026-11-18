// Corner cases found by the Nov 2026 harness (_qa/run.js): payment-integrity
// rules on edits, credits, future dates and invoice-number duplicates.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { check } = require('../services/invoiceIntake/readChecks');
const { _internals: audit } = require('../services/invoiceAudit');
const { _internals: intake } = require('../services/invoiceIntake/intakeService');

const fields = (over = {}) => ({
  invoiceNumber: 'GF-1001', carrier: 'Granite Freight', invoiceDate: '2026-11-10', shipmentRef: 'SH-1',
  lines: [{ description: 'Linehaul', category: 'base', amount: 1000 }, { description: 'Fuel', category: 'fuel', amount: 240 }],
  total: 1240, confidence: 0.97, ...over,
});
const ctx = { knownCarriers: ['GRANITE FREIGHT'], now: new Date('2026-11-14T12:00:00Z') };

test('a credit memo (negative amounts) goes to a person, it does not crash the run', () => {
  const r = check(fields({ lines: [{ description: 'Credit', category: 'base', amount: -1240 }], total: -1240 }), ctx);
  assert.equal(r.ok, false);
  assert.match(r.problems.join(' '), /credit memo/);
});

test('an invoice dated after tomorrow is a misread or not yet billable', () => {
  assert.equal(check(fields({ invoiceDate: '2027-06-01' }), ctx).ok, false);
  assert.equal(check(fields({ invoiceDate: '2026-11-15' }), ctx).ok, true); // time zones: tomorrow is fine
});

test('invoice numbers compare without case, spaces or punctuation', () => {
  for (const n of ['gf-1001', 'GF 1001', 'GF1001', ' GF-1001 ']) assert.equal(intake.invoiceKey(n), intake.invoiceKey('GF-1001'));
  assert.notEqual(intake.invoiceKey('GF-1002'), intake.invoiceKey('GF-1001'));
});

const approved = { id: 'INV-1', invoice_number: 'GF-1001', status: 'Approved', invoiced_amount: 1240, agreed_cost: 1240, shipment_id: 'SH-1', carrier: 'GRANITE FREIGHT' };
const refusedWith = (fn, re) => assert.throws(fn, (e) => e.status === 409 && re.test(e.message));

test('an approved invoice keeps its amount, shipment and carrier', () => {
  refusedWith(() => audit.assertEditAllowed(approved, { invoiced_amount: 1999 }), /invoiced amount can't change/);
  refusedWith(() => audit.assertEditAllowed(approved, { shipment_id: 'SH-2' }), /shipment/);
});

test('saving the form unchanged is allowed (the UI sends every field)', () => {
  assert.doesNotThrow(() => audit.assertEditAllowed(approved, { invoiced_amount: '1240.00', agreed_cost: 1240, shipment_id: 'SH-1', bol_ids: [], status: 'Approved', notes: 'x' }));
});

test('putting it On Hold in the same save unlocks the edit', () => {
  assert.doesNotThrow(() => audit.assertEditAllowed(approved, { status: 'On Hold', invoiced_amount: 1200 }));
});

test('the edit form cannot approve, and Paid is final', () => {
  refusedWith(() => audit.assertEditAllowed({ ...approved, status: 'On Hold' }, { status: 'Approved' }), /Use Approve/);
  refusedWith(() => audit.assertEditAllowed({ ...approved, status: 'On Hold' }, { status: 'Paid' }), /Only an Approved invoice/);
  assert.doesNotThrow(() => audit.assertEditAllowed(approved, { status: 'Paid' }));
  refusedWith(() => audit.assertEditAllowed({ ...approved, status: 'Paid' }, { status: 'On Hold' }), /Paid and closed/);
});

test('sameValue treats numeric strings, numbers and empty values alike', () => {
  assert.equal(audit.sameValue('1240.00', 1240), true);
  assert.equal(audit.sameValue('', null), true);
  assert.equal(audit.sameValue([], null), true);
  assert.equal(audit.sameValue('GF-1', 'GF-1 '), true);
  assert.equal(audit.sameValue(1240, 1240.01), false);
});

const sent = { ...approved, sent_to_ap_at: '2026-11-10T10:00:00Z' };

test('once sent to AP, money fields stay as sent even if moved On Hold', () => {
  refusedWith(() => audit.assertEditAllowed(sent, { status: 'On Hold', invoiced_amount: 1500 }), /was sent to AP on 2026-11-10/);
  refusedWith(() => audit.assertEditAllowed({ ...sent, status: 'Rejected' }, { invoiced_amount: 1500 }), /was sent to AP/);
  assert.doesNotThrow(() => audit.assertEditAllowed(sent, { status: 'On Hold', notes: 'checking with carrier' }));
});

test('a clean corrected revision is Ready to post; a revision that still mismatches is held', async () => {
  const calls = [];
  const invoiceAuditMod = require('../services/invoiceAudit');
  const origDecide = invoiceAuditMod.manualDecide;
  const origSend = invoiceAuditMod.sendToAp;
  invoiceAuditMod.manualDecide = async (a) => { calls.push(['decide', a]); return {}; };
  invoiceAuditMod.sendToAp = async (a) => { calls.push(['send', a]); return {}; };
  const revisionOf = { id: 'INV-1', invoice_number: 'GF-1022', status: 'Disputed', changes: 'total $1561.60 → $1439.60' };
  try {
    const ok = await intake.settle({
      invoice: { id: 'INV-2', invoice_number: 'GF-1022', invoiced_amount: 1439.6 },
      decision: { status: 'Approved' }, audit: { audit: { verdict: 'approve', issues: [] } }, user: {},
      policy: { shadowMode: false }, revisionOf,
    });
    assert.equal(ok.invoiceStatus, 'Approved');
    assert.equal(ok.sentToAp, true);
    assert.match(ok.summary, /Corrected revision of GF-1022 \(was Disputed, now Superseded/);
    assert.match(ok.summary, /Ready to post/);
    assert.equal(calls[0][0], 'send');

    calls.length = 0;
    const bad = await intake.settle({
      invoice: { id: 'INV-3', invoice_number: 'GF-1022', invoiced_amount: 1500 },
      decision: { status: 'Rejected', reason: 'Over contract by $60.40.' }, audit: { audit: { verdict: 'dispute', issues: [{ detail: 'Detention not approved.' }] } }, user: {},
      policy: { shadowMode: false }, revisionOf,
    });
    assert.equal(bad.invoiceStatus, 'On Hold');
    assert.match(bad.summary, /Needs AP review: .*Detention not approved/);
    assert.equal(calls[0][1].decision, 'On Hold');
    assert.match(calls[0][1].reason, /Corrected revision of GF-1022/);
  } finally { invoiceAuditMod.manualDecide = origDecide; invoiceAuditMod.sendToAp = origSend; }
});

test('a revision that would be a second payable invoice is held, not sent', async () => {
  const invoiceAuditMod = require('../services/invoiceAudit');
  const origDecide = invoiceAuditMod.manualDecide;
  const origSend = invoiceAuditMod.sendToAp;
  const calls = [];
  invoiceAuditMod.manualDecide = async (a) => { calls.push(a); return {}; };
  invoiceAuditMod.sendToAp = async () => { const e = new Error('GF-1022: another invoice from this carrier with this invoice number is already approved or paid.'); e.code = 'ONE_PAYABLE'; throw e; };
  try {
    const out = await intake.settle({
      invoice: { id: 'INV-2', invoice_number: 'GF-1022', invoiced_amount: 1439.6 },
      decision: { status: 'Approved' }, audit: { audit: { verdict: 'approve', issues: [] } }, user: {}, policy: { shadowMode: false },
    });
    assert.equal(out.invoiceStatus, 'On Hold');
    assert.match(out.summary, /already approved or paid/);
  } finally { invoiceAuditMod.manualDecide = origDecide; invoiceAuditMod.sendToAp = origSend; }
});

test('a Superseded invoice cannot be edited, decided or paid', () => {
  const sup = { ...approved, status: 'Superseded', metadata: { superseded_by: { id: 'INV-9', number: 'GF-1001' } } };
  refusedWith(() => audit.assertEditAllowed(sup, { notes: 'x' }), /Superseded by the corrected revision GF-1001/);
  refusedWith(() => audit.assertEditAllowed(sup, { status: 'Paid' }), /Superseded/);
  refusedWith(() => audit.assertNotSuperseded(sup), /act on the latest revision/);
});

test('the one-payable DB refusal becomes a plain 409', () => {
  const e = audit.onePayableError(new Error('[DB] invoices update failed: duplicate key value violates unique constraint "uq_invoices_one_payable"'), 'GF-1001');
  assert.equal(e.status, 409);
  assert.equal(e.code, 'ONE_PAYABLE');
  const other = new Error('boom');
  assert.equal(audit.onePayableError(other, 'x'), other);
});
