// Freight Audit line rules — Kestrel Bay panel cases + migration 051 approvals.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { auditInvoice, expectedCharges } = require('../services/agents/freightAudit/auditRules');

const ship = (o = {}) => ({ id: 'SHP-1', carrier: 'RIDGELINE FREIGHT', status: 'Delivered', rate: 412, fuel_surcharge: 98.88, accessorials: 0, total_cost: 510.88, ...o });
const line = (cost_type, invoice_cost, extra = {}) => ({ cost_type, invoice_cost, ...extra });
const run = ({ shipments = [ship()], lines, invoice = {}, siblings = [], approvals = [] }) => {
  const inv = { id: 'INV-1', invoice_number: 'RF-1', carrier: 'Ridgeline Freight', invoiced_amount: lines.reduce((s, l) => s + l.invoice_cost, 0), ...invoice };
  return auditInvoice({ invoice: inv, lines, shipments, siblings, expected: expectedCharges(shipments), approvals });
};

test('clean invoice approves and lists the checks it passed', () => {
  const r = run({ lines: [line('base', 412), line('fuel_surcharge', 98.88)] });
  assert.equal(r.verdict, 'approve');
  assert.ok(r.passed.some((p) => /Linehaul/.test(p)));
  assert.ok(r.passed.some((p) => /Fuel/.test(p)));
});

test('unapproved liftgate is flagged by type when the shipment has approvals', () => {
  const r = run({ lines: [line('base', 412), line('fuel_surcharge', 98.88), line('accessorial', 85, { accessorial_type: 'liftgate' })],
    approvals: [{ accessorial_type: 'detention', max_hours: 2, rate_per_hour: 75 }] });
  assert.equal(r.verdict, 'dispute');
  assert.equal(r.recoverable, 85);
  assert.match(r.issues[0].detail, /no liftgate approval/);
});

test('approved detention 2 hrs x $75 passes clean (not over-strict)', () => {
  const s = ship({ carrier: 'PIONEER EXPRESS', rate: 236, fuel_surcharge: 56.64, total_cost: 292.64 });
  const r = run({ shipments: [s], invoice: { carrier: 'Pioneer Express' },
    lines: [line('base', 236), line('fuel_surcharge', 56.64), line('accessorial', 150, { accessorial_type: 'detention' })],
    approvals: [{ accessorial_type: 'detention', max_hours: 2, rate_per_hour: 75 }] });
  assert.equal(r.verdict, 'approve');
  assert.ok(r.passed.some((p) => /Detention \$150\.00 approved/.test(p)));
});

test('detention over the approval disputes only the excess', () => {
  const r = run({ lines: [line('base', 412), line('fuel_surcharge', 98.88), line('accessorial', 225, { accessorial_type: 'detention' })],
    approvals: [{ accessorial_type: 'detention', max_hours: 2, rate_per_hour: 75 }] });
  assert.equal(r.verdict, 'dispute');
  assert.equal(r.recoverable, 75);
});

test('untyped extras keep the legacy shipment-total check', () => {
  const r = run({ shipments: [ship({ accessorials: 85, total_cost: 595.88 })], lines: [line('base', 412), line('fuel_surcharge', 98.88), line('accessorial', 85)] });
  assert.equal(r.verdict, 'approve');
});

test('right fuel % on an overbilled base is explained', () => {
  const s = ship({ carrier: 'BLUEWATER CARRIERS', rate: 1180, fuel_surcharge: 259.6, total_cost: 1439.6 });
  const r = run({ shipments: [s], invoice: { carrier: 'Bluewater Carriers, Inc.' }, lines: [line('base', 1280), line('fuel_surcharge', 281.6)] });
  assert.equal(r.verdict, 'dispute');
  assert.equal(r.recoverable, 122);
  assert.match(r.issues.find((i) => i.code === 'fuel_over').detail, /fuel % is right but was applied to the overbilled linehaul/);
});

test('resent invoice number is a duplicate', () => {
  const r = run({ lines: [line('base', 412), line('fuel_surcharge', 98.88)], siblings: [{ id: 'INV-0', invoice_number: 'RF-1', status: 'Approved' }] });
  assert.equal(r.verdict, 'dispute');
  assert.match(r.issues[0].detail, /Invoice number RF-1 was already received/);
});

test('cancelled shipment says it should not be billed and pays nothing', () => {
  const r = run({ shipments: [ship({ status: 'Cancelled' })], lines: [line('base', 412), line('fuel_surcharge', 98.88)] });
  assert.equal(r.payAmount, 0);
  assert.match(r.issues[0].detail, /cancelled shipment should not be billed/);
});

test('carrier mismatch holds a clean-looking invoice', () => {
  const r = run({ invoice: { carrier: 'Bluewater Carriers' }, lines: [line('base', 412), line('fuel_surcharge', 98.88)] });
  assert.equal(r.verdict, 'hold');
  assert.equal(r.payAmount, 0);
});

// ── AP policy from the Kestrel Bay problem statement ──────────────
const { getApPolicy } = require('../services/agents/freightAudit/apPolicy');
const { isEarlierCopy, actionFor, readyToPost } = require('../services/agents/freightAudit');
const { applyPolicy } = require('../services/agents/agentRunner');

test('clean invoice over the $2,500 limit goes to a person', () => {
  const s = ship({ rate: 2400, fuel_surcharge: 576, total_cost: 2976 });
  const r = auditInvoice({ invoice: { id: 'I', invoice_number: 'X', carrier: 'Ridgeline', invoiced_amount: 2976 }, lines: [line('base', 2400), line('fuel_surcharge', 576)],
    shipments: [s], siblings: [], expected: expectedCharges([s]), policy: { approvalLimitUsd: 2500 } });
  assert.equal(r.verdict, 'review');
  assert.equal(r.toPerson, true);
});

test('clean invoice under the limit is approved and says so', () => {
  const s = ship();
  const r = auditInvoice({ invoice: { id: 'I', invoice_number: 'X', carrier: 'Ridgeline', invoiced_amount: 510.88 }, lines: [line('base', 412), line('fuel_surcharge', 98.88)],
    shipments: [s], siblings: [], expected: expectedCharges([s]), policy: { approvalLimitUsd: 2500 } });
  assert.equal(r.verdict, 'approve');
  assert.equal(r.toPerson, false);
  assert.ok(r.passed.some((p) => /auto-approve limit/.test(p)));
});

test('cancelled shipment is disputed for the full amount', () => {
  const r = run({ shipments: [ship({ status: 'Cancelled' })], lines: [line('base', 412), line('fuel_surcharge', 98.88)] });
  assert.equal(r.verdict, 'dispute');
  assert.equal(r.recoverable, 510.88);
  assert.equal(r.payAmount, 0);
});

test('shipment not in the TMS is held for BOL/POD and pays nothing', () => {
  const r = auditInvoice({ invoice: { id: 'I', invoice_number: 'BW-1', carrier: 'Bluewater', invoiced_amount: 1439.6, shipment_id: 'KB-SH-40999' },
    lines: [line('base', 1180), line('fuel_surcharge', 259.6)], shipments: [], siblings: [], expected: expectedCharges([]) });
  assert.equal(r.verdict, 'needs_data');
  assert.equal(r.payAmount, 0);
  assert.match(r.issues[0].detail, /KB-SH-40999 is not in the TMS/);
});

test('pay once: the earlier open copy is the original, the later one the duplicate', () => {
  const first = { id: 'A', status: 'On Hold', received_at: '2026-11-09T10:00:00Z' };
  const second = { id: 'B', status: 'On Hold', received_at: '2026-11-09T11:00:00Z' };
  assert.equal(isEarlierCopy(first, second), true);
  assert.equal(isEarlierCopy(second, first), false);
  assert.equal(isEarlierCopy({ id: 'Z', status: 'Approved', received_at: '2026-12-01T00:00:00Z' }, first), true);
});

test('freeze window: shadow mode on Nov 20 – Jan 5, off otherwise; limit and read-only defaults', () => {
  assert.equal(getApPolicy({ env: {}, now: new Date(2026, 10, 25) }).shadowMode, true);
  assert.equal(getApPolicy({ env: {}, now: new Date(2027, 0, 3) }).shadowMode, true);
  assert.equal(getApPolicy({ env: {}, now: new Date(2026, 10, 12) }).shadowMode, false);
  assert.equal(getApPolicy({ env: { FREIGHT_AUDIT_SHADOW_MODE: 'on' }, now: new Date(2026, 5, 1) }).shadowMode, true);
  const p = getApPolicy({ env: {} });
  assert.equal(p.approvalLimitUsd, 2500);
  assert.equal(p.erpReadOnly, true);
});

test('disputes always need a person; clean approvals need one only in shadow mode', () => {
  const base = { invoice: { id: 'I', invoice_number: 'X', carrier: 'Ridgeline', invoiced_amount: 510.88, status: 'On Hold' }, shipments: [ship()], expected: { total: 510.88 } };
  const live = { approvalLimitUsd: 2500, erpReadOnly: true, shadowMode: false };
  const clean = actionFor({ ...base, audit: { verdict: 'approve', issues: [], recoverable: 0, payAmount: 510.88 } }, live);
  assert.equal(clean.type, 'APPROVE_INVOICE');
  assert.equal(clean.requireApproval, false);
  assert.match(clean.payload.reason, /ready-to-post/);
  assert.equal(actionFor({ ...base, audit: { verdict: 'approve', issues: [], recoverable: 0, payAmount: 510.88 } }, { ...live, shadowMode: true }).requireApproval, true);
  const dispute = actionFor({ ...base, audit: { verdict: 'dispute', issues: [{ code: 'base_over_contract', detail: 'x', amount: 122 }], recoverable: 122, payAmount: 388.88 } }, live);
  assert.equal(dispute.type, 'DISPUTE_INVOICE');
  assert.equal(dispute.requireApproval, true);
  const [tagged] = applyPolicy('freight_audit', [dispute]);
  assert.equal(tagged.requiresApproval, true);
  assert.equal('requireApproval' in tagged, false);
});

test('ready-to-post list: clean at billed, short-pays at the pay amount, holds left out', () => {
  const mk = (id, verdict, billed, payAmount, recoverable = 0) => ({ invoice: { id, invoice_number: id, carrier: 'C', invoiced_amount: billed }, shipments: [], audit: { verdict, payAmount, recoverable } });
  const list = readyToPost([mk('A', 'approve', 510.88, 510.88), mk('B', 'dispute', 1561.6, 1439.6, 122), mk('C', 'needs_data', 1439.6, 0), mk('D', 'dispute', 510.88, 0, 510.88)]);
  assert.deepEqual(list.map((x) => [x.number, x.payAmount]), [['A', 510.88], ['B', 1439.6]]);
});

// ── Policy edge cases (panel review, Nov 16) ─────────────────────────
test('a shipment with no contract rate is held, never read as a $0 clean match', () => {
  const ship = { id: 'KB-TEST', carrier: 'RIDGELINE FREIGHT', status: 'Delivered', rate: null, fuel_surcharge: 0, accessorials: 0, total_cost: 0 };
  const r = auditInvoice({ invoice: { invoice_number: 'T-1', carrier: 'RIDGELINE FREIGHT', invoiced_amount: 412 }, lines: [{ cost_type: 'base', invoice_cost: 412 }],
    shipments: [ship], siblings: [], expected: expectedCharges([ship]), policy: { approvalLimitUsd: 2500 } });
  assert.strictEqual(r.verdict, 'needs_data');
  assert.ok(r.issues.some((i) => i.code === 'no_contract_rate'));
});

test('the $1 rounding tolerance never lets an unapproved extra through', () => {
  const ship = { id: 'KB-TEST', carrier: 'RIDGELINE FREIGHT', status: 'Delivered', rate: 412, fuel_surcharge: 98.88, accessorials: 0, total_cost: 510.88 };
  const r = auditInvoice({ invoice: { invoice_number: 'T-2', carrier: 'RIDGELINE FREIGHT', invoiced_amount: 511.38 },
    lines: [{ cost_type: 'base', invoice_cost: 412 }, { cost_type: 'fuel_surcharge', invoice_cost: 98.88 }, { cost_type: 'accessorial', invoice_cost: 0.5, description: 'Admin fee' }],
    shipments: [ship], siblings: [], expected: expectedCharges([ship]), policy: { approvalLimitUsd: 2500 } });
  assert.ok(r.issues.some((i) => i.code === 'accessorial_unapproved'));
  assert.notStrictEqual(r.verdict, 'approve');
});

test('a clean invoice over $2,500 goes to a person', () => {
  const ship = { id: 'KB-TEST', carrier: 'BLUEWATER CARRIERS', status: 'Delivered', rate: 2049.19, fuel_surcharge: 450.82, accessorials: 0, total_cost: 2500.01 };
  const r = auditInvoice({ invoice: { invoice_number: 'T-3', carrier: 'BLUEWATER CARRIERS', invoiced_amount: 2500.01 },
    lines: [{ cost_type: 'base', invoice_cost: 2049.19 }, { cost_type: 'fuel_surcharge', invoice_cost: 450.82 }],
    shipments: [ship], siblings: [], expected: expectedCharges([ship]), policy: { approvalLimitUsd: 2500 } });
  assert.strictEqual(r.verdict, 'review');
  assert.ok(r.toPerson);
});

