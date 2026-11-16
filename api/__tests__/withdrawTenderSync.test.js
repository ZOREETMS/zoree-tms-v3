// Withdraw tender: a shipment going Tendered → Planned must bring its
// tendered orders back to Planned (2026-10-17 fix), and must not touch
// orders in any other state.
//
// Run with: node --test api/__tests__/withdrawTenderSync.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const writes = [];
const histories = [];
let orderRows = {};

function mock(rel, exports) {
  const abs = require.resolve(path.join(__dirname, rel));
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}

mock('../services/supabase.js', {
  dbSelect: async (table, { filters }) => {
    const id = filters[0][2];
    if (table === 'shipments') return [{ id, order_ids: Object.keys(orderRows) }];
    return orderRows[id] ? [{ id, ...orderRows[id] }] : [];
  },
  dbUpdate: async (table, id, patch) => { writes.push({ table, id, patch }); orderRows[id] = { ...orderRows[id], ...patch }; return {}; },
});
mock('../services/changeHistory.js', { recordChange: async (r) => { histories.push(r); } });
mock('../services/eventBus.js', { bus: { emit: () => {} }, EVENTS: { ORDER_UPDATED: 'order.updated' } });
mock('../services/messagingHub/writer.js', { recordInbound: async () => ({}) });
mock('../services/messagingHub/types.js', { MESSAGE_TYPE: {}, SYSTEM_PARTY: {} });

const { syncLinkedOrdersForShipmentStatus, SHIPMENT_STATUS_TO_ORDER_STATUS } = require('../services/shipmentEvents');

test('Planned is a mapped shipment status, so updateShipment triggers the sync', () => {
  assert.equal(SHIPMENT_STATUS_TO_ORDER_STATUS.Planned, 'Planned');
});

test('withdraw returns tendered orders to Planned and leaves others alone', async () => {
  writes.length = 0; histories.length = 0;
  orderRows = {
    'ORD-T': { status: 'Tendered', shipment_id: 'SHP-1' },
    'ORD-A': { status: 'Tender Accepted', shipment_id: 'SHP-1' },
    'ORD-X': { status: 'Exception', shipment_id: 'SHP-1' },
    'ORD-D': { status: 'Delivered', shipment_id: 'SHP-1' },
    'ORD-P': { status: 'Planned', shipment_id: 'SHP-1' },
  };
  const r = await syncLinkedOrdersForShipmentStatus({ shipmentId: 'SHP-1', newStatus: 'Planned', via: 'test' });
  assert.deepEqual(r.updated.sort(), ['ORD-A', 'ORD-T']);
  const reasons = Object.fromEntries(r.skipped.map((s) => [s.id, s.reason]));
  assert.deepEqual(reasons, { 'ORD-X': 'not_tendered', 'ORD-D': 'terminal', 'ORD-P': 'already_set' });
  assert.deepEqual(writes.map((w) => w.patch), [{ status: 'Planned' }, { status: 'Planned' }], 'status column only');
  assert.ok(histories.every((h) => h.after === 'Planned' && h.action === 'status'));
});

test('existing tender mapping is unchanged', async () => {
  orderRows = { 'ORD-1': { status: 'Planned', shipment_id: 'SHP-1' } };
  const r = await syncLinkedOrdersForShipmentStatus({ shipmentId: 'SHP-1', newStatus: 'Tendered', via: 'test' });
  assert.deepEqual(r.updated, ['ORD-1']);
});
