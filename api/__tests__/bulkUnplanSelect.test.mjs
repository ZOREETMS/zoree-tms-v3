import test from 'node:test';
import assert from 'node:assert';

// Mirrors frontend/src/services/bulkUnplanService.js selectUnplannable.
// Duplicated rather than imported because the service is an ESM frontend
// module that imports ordersService (which pulls in browser-only deps);
// the selection rule is the part worth pinning, and it is pure.
const UNPLANNABLE = ["Planned", "Consolidated", "Planning Failed"];
const DOWNSTREAM = ["Tendered", "Tender Accepted", "Shipped", "In Transit", "Delivered", "Cancelled"];

function selectUnplannable(orders, opts = {}) {
  const { includeDownstream = false, filter } = opts;
  return (orders || []).filter((o) => {
    if (!o || !o.id) return false;
    if (filter && !filter(o)) return false;
    const status = o.status || "Unplanned";
    if (!includeDownstream && DOWNSTREAM.includes(status)) return false;
    const shipmentId = o.shipment_id || o.shipmentId || null;
    return Boolean(shipmentId) || UNPLANNABLE.includes(status);
  });
}

const o = (id, status, shipment_id = null) => ({ id, status, shipment_id });

test('picks up planning-produced states', () => {
  const got = selectUnplannable([
    o('A', 'Planned', 'SHP1'), o('B', 'Consolidated', 'SHP1'), o('C', 'Planning Failed'),
  ]).map((x) => x.id);
  assert.deepEqual(got, ['A', 'B', 'C']);
});

test('leaves Unplanned orders alone - nothing to undo', () => {
  assert.deepEqual(selectUnplannable([o('A', 'Unplanned')]), []);
});

test('never touches downstream states by default', () => {
  const rows = DOWNSTREAM.map((s, i) => o(`D${i}`, s, 'SHP9'));
  assert.deepEqual(selectUnplannable(rows), [],
    'a tendered or delivered load must not be reversed by a toolbar button');
});

test('includeDownstream is opt-in and does reach them', () => {
  const rows = [o('A', 'Tendered', 'SHP1'), o('B', 'Delivered', 'SHP2')];
  assert.equal(selectUnplannable(rows, { includeDownstream: true }).length, 2);
});

test('an order holding a shipment_id counts even on an odd status', () => {
  assert.deepEqual(selectUnplannable([o('A', 'Some New Status', 'SHP1')]).map((x) => x.id), ['A']);
});

test('camelCase shipmentId is honoured too', () => {
  // dbToOrderApi exposes shipment_id only as shipmentId - see teamsBot cmdUnplan.
  assert.deepEqual(selectUnplannable([{ id: 'A', status: 'Whatever', shipmentId: 'SHP1' }]).map((x) => x.id), ['A']);
});

test('filter narrows the set - used to scope to the TEST-QE fixture', () => {
  const rows = [o('TEST-QE-A01', 'Planned', 'SHP1'), o('ORD-9', 'Planned', 'SHP2')];
  const got = selectUnplannable(rows, { filter: (x) => x.id.startsWith('TEST-QE-') });
  assert.deepEqual(got.map((x) => x.id), ['TEST-QE-A01']);
});

test('junk rows are skipped, not thrown on', () => {
  assert.deepEqual(selectUnplannable([null, undefined, {}, o('A', 'Planned', 'S1')]).map((x) => x.id), ['A']);
});
