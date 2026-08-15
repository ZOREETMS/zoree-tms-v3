// Tests for the carrier tender-response cascade (2026-08-11).
//
// Run with: node --test api/__tests__/tenderIn.test.js
//
// recordTenderResponse used to stop at the message_log row — a carrier
// ACCEPT was a domain no-op. These tests pin the new contract:
//   audit row FIRST, then a best-effort, idempotent status cascade
//   through shipService.updateShipment, applied ONLY from 'Tendered'.
//
// All I/O modules are stubbed via require.cache (CommonJS DI seam) so
// no DB/network is touched.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// ── require.cache stubs (must precede requiring tenderIn) ───────────
const calls = { recordInbound: [], updateShipment: [], notifyAccepted: [], notifyRejected: [], omsSync: [] };
let shipRow = null; // what dbSelect('shipments') returns

function mock(rel, exports) {
  const abs = require.resolve(path.join(__dirname, rel));
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}

mock('../services/messagingHub/writer.js', {
  recordInbound: async (args) => { calls.recordInbound.push(args); return { id: 'msg-1', persisted: true }; },
});
mock('../services/messagingHub/correlate.js', {
  resolveByCorrelationId: async (cid) => (cid === 'tender-known' ? { shipmentId: 'SHP-1', orderId: 'ORD-1' } : null),
  resolveShipmentByExternalRef: async (ref) => (ref === 'SHP-DIRECT' ? 'SHP-DIRECT' : null),
});
mock('../services/supabase.js', {
  dbSelect: async () => (shipRow ? [shipRow] : []),
});
mock('../services/shipments.js', {
  updateShipment: async (id, updates, tenant, ctx) => { calls.updateShipment.push({ id, updates, ctx }); return { id, ...updates }; },
});
mock('../services/teamsNotify.js', {
  notifyTenderAccepted: (a) => calls.notifyAccepted.push(a),
  notifyTenderRejected: (a) => calls.notifyRejected.push(a),
});
mock('../services/omsSync.js', {
  syncTenderAcceptToOms: async (p) => { calls.omsSync.push(p); return { updated: 1 }; },
});

const tenderIn = require('../services/tendering/tenderIn');

function reset(status) {
  for (const k of Object.keys(calls)) calls[k].length = 0;
  shipRow = status === null ? null : {
    id: 'SHP-1', status, carrier: 'AVERITT EXPRESS', mode: 'LTL',
    service_level: 'Standard', pickup_date: '2026-08-26', delivery_date: '2026-08-28',
  };
}

test('correlationId is required', async () => {
  await assert.rejects(() => tenderIn.recordTenderResponse({}, null), /correlationId is required/);
});

test('ACCEPT on a Tendered shipment applies the full cascade', async () => {
  reset('Tendered');
  const r = await tenderIn.recordTenderResponse(
    { correlationId: 'tender-known', response: 'ACCEPT' }, { email: 'carrier-ingest' });
  // audit row first, with normalized decision folded into the payload
  assert.equal(calls.recordInbound.length, 1);
  assert.equal(calls.recordInbound[0].payload.normalized, 'ACCEPT');
  // cascade through the single writer
  assert.equal(calls.updateShipment.length, 1);
  assert.deepEqual(calls.updateShipment[0].updates, { status: 'Tender Accepted' });
  assert.equal(calls.updateShipment[0].ctx.via, 'carrier-tender-response');
  // side effects
  assert.equal(calls.notifyAccepted.length, 1);
  assert.equal(calls.omsSync.length, 1);
  assert.equal(r.applied, true);
  assert.equal(r.appliedStatus, 'Tender Accepted');
  assert.equal(r.previousStatus, 'Tendered');
});

test('DECLINE maps to Tender Rejected and skips the OMS mirror', async () => {
  reset('Tendered');
  const r = await tenderIn.recordTenderResponse(
    { correlationId: 'tender-known', response: 'reject' }, null);
  assert.deepEqual(calls.updateShipment[0].updates, { status: 'Tender Rejected' });
  assert.equal(calls.notifyRejected.length, 1);
  assert.equal(calls.omsSync.length, 0);
  assert.equal(r.applied, true);
});

test('duplicate ACCEPT is absorbed (idempotent, no second cascade)', async () => {
  reset('Tender Accepted');
  const r = await tenderIn.recordTenderResponse(
    { correlationId: 'tender-known', response: 'ACCEPTED' }, null);
  assert.equal(calls.recordInbound.length, 1); // still audited
  assert.equal(calls.updateShipment.length, 0); // but not re-applied
  assert.equal(r.alreadyApplied, true);
  assert.equal(r.applied, false);
});

test('ACCEPT on a non-Tendered shipment records but never mutates', async () => {
  reset('Planned');
  const r = await tenderIn.recordTenderResponse(
    { correlationId: 'tender-known', response: 'ACCEPT' }, null);
  assert.equal(calls.updateShipment.length, 0);
  assert.match(r.stateWarning, /not 'Tendered'/);
  assert.equal(r.applied, false);
});

test('unknown correlation id → recorded for triage, nothing applied', async () => {
  reset('Tendered');
  const r = await tenderIn.recordTenderResponse(
    { correlationId: 'tender-unknown', response: 'ACCEPT' }, null);
  assert.equal(calls.recordInbound.length, 1);
  assert.equal(calls.updateShipment.length, 0);
  assert.equal(r.linkedShipmentId, null);
  assert.match(r.stateWarning, /no shipment linkage/);
});

test('unrecognized response → recorded only', async () => {
  reset('Tendered');
  const r = await tenderIn.recordTenderResponse(
    { correlationId: 'tender-known', response: 'MAYBE' }, null);
  assert.equal(calls.recordInbound.length, 1);
  assert.equal(calls.updateShipment.length, 0);
  assert.match(r.stateWarning, /unrecognized response/);
});

test('shipmentId fallback links when correlation lookup misses', async () => {
  reset('Tendered');
  shipRow.id = 'SHP-DIRECT';
  const r = await tenderIn.recordTenderResponse(
    { correlationId: 'tender-unknown', response: 'ACCEPT', shipmentId: 'SHP-DIRECT' }, null);
  assert.equal(r.linkedShipmentId, 'SHP-DIRECT');
  assert.equal(calls.updateShipment.length, 1);
});

test('tender statuses cascade to linked orders (shipmentEvents map)', () => {
  // Guard against someone "simplifying" the map back to transit-only —
  // that regression re-opens the bot-vs-web accept desync.
  delete require.cache[require.resolve(path.join(__dirname, '../services/supabase.js'))];
  const src = require('fs').readFileSync(path.join(__dirname, '../services/shipmentEvents.js'), 'utf8');
  assert.match(src, /'Tendered':\s*'Tendered'/);
  assert.match(src, /'Tender Accepted':\s*'Tender Accepted'/);
});
