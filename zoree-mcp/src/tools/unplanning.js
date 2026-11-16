// ════════════════════════════════════════════════════════════════════
// unplanning.js — the reverse of plan_order / reserve_dock / tendering.
//
//   unplan_order     (WRITE)  order → Unplanned, off its shipment
//   cancel_shipment  (WRITE)  delete a shipment, its orders → Unplanned
//   release_dock     (WRITE)  clear a shipment's dock door + window
//   withdraw_tender  (WRITE)  Tendered shipment → Planned
//
// Every write goes through the same audited Express routes the web app
// uses, so role checks, change_history and the OMS mirror still apply:
//
//   unplan_order     PATCH  /api/orders/:id { status:'Unplanned', shipmentId:null }
//                    — the Orders page "Unplan" path (ordersService.
//                    unplanOrderFromShipment). Server-side the route
//                    writes the per-field + 'unassign' history rows,
//                    deletes the shipment when it was the last order
//                    (and its MBOL when that was the last CBOL), or
//                    recalcs weight/pieces/cost/order_ids when other
//                    orders stay on it.
//   cancel_shipment  DELETE /api/shipments/:id
//                    — the Shipments page delete / ZoreeAI CANCEL_SHIPMENT
//                    path. Server cascades every linked order back to
//                    Unplanned with 'unassign' history. MBOL children
//                    first, then the master; an orphaned MBOL is removed
//                    after its last CBOL, as the web app does.
//   release_dock     PATCH  /api/shipments/:id { dock fields: null }
//                    — same route as reserve_dock; one history row per
//                    cleared field and the OMS dock mirror clears too.
//   withdraw_tender  PATCH  /api/shipments/:id { status:'Planned' }
//                    — ShipmentsPage.withdrawTender (MBOL → its CBOLs).
//                    The API's shipment→order sync now returns tendered
//                    orders to 'Planned' (shipmentEvents, 2026-10-17);
//                    the order reset below is a fallback for API builds
//                    from before that fix and finds nothing to do after.
//
// Safety rule shared with bulkUnplanService / bulkShipmentDeleteService:
// once a carrier has accepted or the freight is moving, reversing it is
// a business event, not an undo — those statuses are refused. A
// Tendered load must be withdrawn first so the carrier isn't left
// holding a live tender.
// ════════════════════════════════════════════════════════════════════

const { z } = require('zod');
const { compact, safeHandler } = require('./format');
const { ZoreeApiError } = require('../services/zoreeApiClient');

const COMMITTED = ['Tender Accepted', 'Confirmed', 'Shipped', 'In Transit', 'Delivered'];
const WRITE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

const enc = encodeURIComponent;

async function findShipment(api, id) {
  const data = await api.get('/api/shipments', { id });
  return (data && Array.isArray(data.shipments) && data.shipments[0]) || null;
}

async function loadShipment(api, id) {
  const s = await findShipment(api, id);
  if (!s) throw new ZoreeApiError(404, `Shipment ${id} not found`);
  return s;
}

async function allShipments(api) {
  const data = await api.get('/api/shipments');
  return (data && data.shipments) || [];
}

function dockOf(s) {
  return compact({ door: s.dock_door, window: s.dock_time });
}

/** Refuse statuses where a carrier is committed; Tendered needs a withdraw first. */
function assertReversible(kind, id, status, shipmentId) {
  const st = String(status || '');
  if (st === 'Tendered') {
    throw new ZoreeApiError(409, `${kind} ${id} is Tendered — withdraw the tender first `
      + `(withdraw_tender on ${shipmentId || id}) so the carrier isn't left holding it`);
  }
  if (COMMITTED.includes(st)) {
    throw new ZoreeApiError(409, `${kind} ${id} is '${st}' — a carrier is committed, so it can't be `
      + 'unplanned or cancelled from here. Handle it with the carrier in the web app.');
  }
}

// ── unplan_order ─────────────────────────────────────────────────────
async function unplanOrder(api, { order_id }) {
  const order = await api.get(`/api/orders/${enc(order_id)}/full`);
  const shipmentId = order.shipment_id || order.shipmentId || null;
  const status = String(order.status || '');
  if (!shipmentId && (!status || status === 'Unplanned')) {
    throw new ZoreeApiError(409, `Order ${order_id} is already Unplanned`);
  }
  if (status === 'Cancelled') throw new ZoreeApiError(409, `Order ${order_id} is Cancelled`);

  // The shipment decides whether a tender is live: an order can still read
  // 'Tendered' after its carrier rejected (shipment 'Tender Rejected'), and
  // that order is free to unplan. Committed order statuses always block.
  const ship = shipmentId ? await findShipment(api, shipmentId) : null;
  if (COMMITTED.includes(status)) assertReversible('Order', order_id, status, shipmentId);
  if (ship) assertReversible('Shipment', ship.id, ship.status, ship.id);
  else assertReversible('Order', order_id, status, shipmentId);

  const row = await api.patch(`/api/orders/${enc(order_id)}`, { status: 'Unplanned', shipmentId: null });
  const after = shipmentId ? await findShipment(api, shipmentId) : null;
  const others = ((ship && ship.order_ids) || []).filter((o) => o !== order_id);

  return compact({
    unplanned: true,
    order: compact({ id: order_id, status: (row && row.status) || 'Unplanned', previous_status: status }),
    previous_shipment: shipmentId || undefined,
    shipment_deleted: shipmentId ? !after : undefined,
    shipment_kept_with_orders: after ? ((after.order_ids && after.order_ids.length ? after.order_ids : others)) : undefined,
    dock_released: ship && !after && ship.dock_door ? dockOf(ship) : undefined,
    note: after && after.dock_door
      ? `${shipmentId} still holds ${after.dock_door} ${after.dock_time || ''} for its other orders.`.trim()
      : undefined,
  });
}

// ── cancel_shipment ──────────────────────────────────────────────────
async function cancelShipment(api, { shipment_id }) {
  const ship = await loadShipment(api, shipment_id);
  if (String(ship.status) === 'Cancelled') throw new ZoreeApiError(409, `Shipment ${ship.id} is already Cancelled`);
  assertReversible('Shipment', ship.id, ship.status, ship.id);

  const needAll = ship.bol_type === 'MBOL' || (ship.bol_type === 'CBOL' && ship.master_shipment_id);
  const everything = needAll ? await allShipments(api) : [];
  const children = ship.bol_type === 'MBOL'
    ? everything.filter((s) => s.master_shipment_id === ship.id) : [];
  for (const c of children) assertReversible('Shipment', c.id, c.status, c.id);

  const deleted = [];
  let ordersUnassigned = 0;
  for (const c of children) {
    const r = await api.delete(`/api/shipments/${enc(c.id)}`);
    deleted.push(c.id);
    ordersUnassigned += Number((r && r.unassignedOrders) || 0);
  }
  const res = await api.delete(`/api/shipments/${enc(ship.id)}`);
  deleted.push(ship.id);
  ordersUnassigned += Number((res && res.unassignedOrders) || 0);

  let masterDeleted;
  if (ship.bol_type === 'CBOL' && ship.master_shipment_id) {
    const siblings = everything.filter((s) => s.master_shipment_id === ship.master_shipment_id && s.id !== ship.id);
    if (!siblings.length) {
      try {
        await api.delete(`/api/shipments/${enc(ship.master_shipment_id)}`);
        masterDeleted = ship.master_shipment_id;
      } catch { /* cosmetic — the CBOL is already gone */ }
    }
  }

  return compact({
    cancelled: true,
    shipment_id: ship.id,
    deleted_shipments: deleted,
    master_deleted: masterDeleted,
    orders_returned_to_unplanned: ordersUnassigned,
    order_ids: ship.order_ids,
    dock_released: ship.dock_door ? dockOf(ship) : undefined,
    carrier: ship.carrier,
    total_cost: ship.total_cost,
  });
}

// ── release_dock ─────────────────────────────────────────────────────
async function releaseDock(api, { shipment_id }) {
  const ship = await loadShipment(api, shipment_id);
  if (!ship.dock_door && !ship.dock_time && !ship.loading_start) {
    throw new ZoreeApiError(409, `Shipment ${ship.id} has no dock door reserved`);
  }
  if (['In Transit', 'Delivered'].includes(String(ship.status))) {
    throw new ZoreeApiError(409, `Shipment ${ship.id} is '${ship.status}'; its dock record is history and is kept`);
  }
  const u = await api.patch(`/api/shipments/${enc(ship.id)}`,
    { dockDoor: null, dockTime: null, loadingStart: null, loadingEnd: null }) || {};
  const still = u.dockDoor || u.dock_door;
  if (still) throw new ZoreeApiError(500, `The API kept ${still} on ${ship.id}; the dock was not released`);
  return { released: true, shipment_id: ship.id, previous_dock: compact({ ...dockOf(ship),
    loading_start: ship.loading_start, loading_end: ship.loading_end }) };
}

// ── withdraw_tender ──────────────────────────────────────────────────
async function withdrawTender(api, { shipment_id }) {
  const ship = await loadShipment(api, shipment_id);
  if (String(ship.status) !== 'Tendered') {
    throw new ZoreeApiError(409, `Shipment ${ship.id} is '${ship.status}', not Tendered — there is no open tender to withdraw`);
  }
  const children = ship.bol_type === 'MBOL'
    ? (await allShipments(api)).filter((s) => s.master_shipment_id === ship.id && s.bol_type === 'CBOL')
    : [];

  await api.patch(`/api/shipments/${enc(ship.id)}`, { status: 'Planned' });
  for (const c of children) await api.patch(`/api/shipments/${enc(c.id)}`, { status: 'Planned' });

  const orderIds = [ship, ...children].flatMap((s) => s.order_ids || []);
  const reset = [];
  for (const oid of orderIds) {
    const o = await api.get(`/api/orders/${enc(oid)}/full`).catch(() => null);
    if (o && o.status === 'Tendered') {
      await api.patch(`/api/orders/${enc(oid)}`, { status: 'Planned' });
      reset.push(oid);
    }
  }
  return compact({
    withdrawn: true,
    shipment_id: ship.id,
    status: 'Planned',
    carrier: ship.carrier,
    cbols_withdrawn: children.map((c) => c.id),
    orders_back_to_planned: reset,
  });
}

function registerUnplanningTools(server, api) {
  const shipmentId = z.string().min(1).describe('Shipment id, e.g. SHP-2026-100996');

  server.registerTool('unplan_order', {
    title: 'Unplan order',
    description: 'Send one planned order back to Unplanned and take it off its shipment, like "Unplan" on the Orders '
      + 'page (audited). If it was the shipment\'s only order the shipment is deleted, which also frees its dock door; '
      + 'otherwise the shipment keeps its other orders and is re-totalled. Refuses Tendered orders (withdraw_tender '
      + 'first) and anything a carrier has accepted or is moving. Tell the user the order, shipment and what will be '
      + 'deleted, and get their go-ahead first.',
    inputSchema: { order_id: z.string().min(1).describe('Order id, e.g. ORD-457723') },
    annotations: { title: 'Unplan order', ...WRITE },
  }, safeHandler((args) => unplanOrder(api, args)));

  server.registerTool('cancel_shipment', {
    title: 'Cancel shipment',
    description: 'Cancel a shipment the way the Shipments page and ZoreeAI do: the shipment is deleted and every order '
      + 'on it goes back to Unplanned (audited), freeing its dock door. An MBOL takes its CBOLs with it; a master left '
      + 'with no CBOLs is removed. Refuses Tendered (withdraw_tender first) and accepted / in-transit / delivered '
      + 'shipments. Tell the user the shipment, carrier and orders affected and get their go-ahead first.',
    inputSchema: { shipment_id: shipmentId },
    annotations: { title: 'Cancel shipment', ...WRITE },
  }, safeHandler((args) => cancelShipment(api, args)));

  server.registerTool('release_dock', {
    title: 'Release dock door',
    description: 'Clear a shipment\'s dock door and loading window (the reverse of reserve_dock), through the same '
      + 'audited route, mirrored to OMS. The shipment itself is unchanged. Refuses In Transit / Delivered shipments. '
      + 'Confirm with the user first.',
    inputSchema: { shipment_id: shipmentId },
    annotations: { title: 'Release dock door', ...WRITE },
  }, safeHandler((args) => releaseDock(api, args)));

  server.registerTool('withdraw_tender', {
    title: 'Withdraw tender',
    description: 'Withdraw an open tender: a Tendered shipment (and an MBOL\'s CBOLs) goes back to Planned and its '
      + 'Tendered orders back to Planned, like "Withdraw" on the Shipments page. Only for status Tendered. Tell the '
      + 'user the carrier will lose the tender and get their go-ahead first.',
    inputSchema: { shipment_id: shipmentId },
    annotations: { title: 'Withdraw tender', ...WRITE },
  }, safeHandler((args) => withdrawTender(api, args)));
}

module.exports = { registerUnplanningTools, unplanOrder, cancelShipment, releaseDock, withdrawTender };
