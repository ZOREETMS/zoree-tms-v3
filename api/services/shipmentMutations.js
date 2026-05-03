// ═══════════════════════════════════════════════════════════════════
// Shipment Mutations Service — REQ-03.
//
// Business logic for:
//   addOrderToShipment({ shipmentId, orderId, user, tenantConfig })
//     - Validates the shipment exists and is still editable
//     - Validates the order exists and is Unplanned
//     - Appends the order to shipment.order_ids
//     - Adds order.weight / order.pieces to shipment totals
//     - Recalculates shipment.total_cost proportionally to new weight
//     - Updates order: shipment_id + status='Planned'
//     - Emits REQ-02 history rows for both entities
//
// All Supabase writes go through api/services/supabase.js. No HTTP
// concerns — the route layer (POST /api/shipments/:id/add-order) is
// the only caller.
// ═══════════════════════════════════════════════════════════════════

const db = require('./supabase');
const history = require('./changeHistory');
const { bus, EVENTS } = require('./eventBus');

// Shipment statuses where no further orders may be added. Keep in sync
// with any front-end assertion on shipment lifecycle.
const LOCKED_STATUSES = new Set(['Delivered', 'Cancelled']);

// Statuses where re-quoting / changing the carrier is a no-op and would
// just mask the operational reality (the load already shipped or was
// cancelled). Locked == no carrier change. Same set today as
// LOCKED_STATUSES, kept separately so the two policies can diverge.
const CARRIER_CHANGE_LOCKED_STATUSES = new Set(['Delivered', 'Cancelled', 'In Transit']);

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Proportionally recalculate a lump-sum cost when weight changes.
 *   - If old weight is 0 (or unknown) and old cost is 0 → new cost stays 0.
 *   - If old weight is 0 but old cost is > 0 → we cannot derive a $/lb
 *     rate, so we return the old cost unchanged and flag via the `note`
 *     field so the caller can surface a warning.
 *   - Otherwise newCost = oldCost * (newWeight / oldWeight), rounded to
 *     cents.
 *
 * Also scales `fuel_surcharge` and `accessorials` the same way when
 * those columns are present and non-null on the shipment row.
 */
function recalcCost({ oldWeight, oldCost, newWeight, oldFsc = null, oldAcc = null }) {
  const ow = num(oldWeight, 0);
  const oc = num(oldCost, 0);
  const nw = num(newWeight, 0);
  if (ow <= 0) {
    return {
      total_cost: oc,
      fuel_surcharge: oldFsc,
      accessorials: oldAcc,
      scale: 1,
      note: oc > 0 ? 'cost_unchanged_zero_old_weight' : 'no_prior_cost',
    };
  }
  const scale = nw / ow;
  const round = (x) => Math.round(Number(x) * 100) / 100;
  return {
    total_cost:    round(oc * scale),
    fuel_surcharge: oldFsc == null ? oldFsc : round(oldFsc * scale),
    accessorials:   oldAcc == null ? oldAcc : round(oldAcc * scale),
    scale,
    note: 'scaled_by_weight',
  };
}

// ── Entry point ──────────────────────────────────────────────────
async function addOrderToShipment({ shipmentId, orderId, user = null, tenantConfig = null }) {
  if (!shipmentId) { const e = new Error('shipmentId is required'); e.status = 400; throw e; }
  if (!orderId)    { const e = new Error('orderId is required');    e.status = 400; throw e; }

  // 1. Fetch shipment
  const shipRows = await db.dbSelect('shipments', {
    filters: [['id', 'eq', shipmentId]], limit: 1,
  }, tenantConfig);
  const shipBefore = Array.isArray(shipRows) && shipRows.length ? shipRows[0] : null;
  if (!shipBefore) { const e = new Error(`Shipment not found: ${shipmentId}`); e.status = 404; throw e; }
  if (LOCKED_STATUSES.has(shipBefore.status)) {
    const e = new Error(`Shipment ${shipmentId} is ${shipBefore.status} and cannot accept new orders`);
    e.status = 409;
    throw e;
  }

  // 2. Fetch order
  const ordRows = await db.dbSelect('orders', {
    filters: [['id', 'eq', orderId]], limit: 1,
  }, tenantConfig);
  const orderBefore = Array.isArray(ordRows) && ordRows.length ? ordRows[0] : null;
  if (!orderBefore) { const e = new Error(`Order not found: ${orderId}`); e.status = 404; throw e; }

  if (orderBefore.shipment_id && orderBefore.shipment_id === shipmentId) {
    const e = new Error(`Order ${orderId} is already on shipment ${shipmentId}`);
    e.status = 409;
    throw e;
  }
  if (orderBefore.shipment_id && orderBefore.shipment_id !== shipmentId) {
    const e = new Error(`Order ${orderId} is already assigned to ${orderBefore.shipment_id}; unplan it first`);
    e.status = 409;
    throw e;
  }
  if (orderBefore.status && !['Unplanned', 'Planning Failed'].includes(orderBefore.status)) {
    const e = new Error(`Order ${orderId} status '${orderBefore.status}' is not eligible to be added to a shipment`);
    e.status = 409;
    throw e;
  }

  // 3. Compute new shipment totals
  const existingOrderIds = Array.isArray(shipBefore.order_ids) ? shipBefore.order_ids.slice() : [];
  if (existingOrderIds.includes(orderId)) {
    // Defensive — should have been caught by the shipment_id check above.
    const e = new Error(`Shipment ${shipmentId} already references order ${orderId}`);
    e.status = 409;
    throw e;
  }
  const newOrderIds = [...existingOrderIds, orderId];
  const newWeight = num(shipBefore.weight) + num(orderBefore.weight);
  const newPieces = num(shipBefore.pieces) + num(orderBefore.pieces);

  const recalc = recalcCost({
    oldWeight: shipBefore.weight,
    oldCost:   shipBefore.total_cost,
    newWeight,
    oldFsc: shipBefore.fuel_surcharge ?? null,
    oldAcc: shipBefore.accessorials ?? null,
  });

  // 4. Update shipment and order — order matters:
  //    - Write the shipment first so the order's shipment_id points at a
  //      row we've already updated. If the order update later fails, the
  //      shipment still reflects the attempted add; we reconcile by
  //      rolling the shipment back.
  const shipPatch = {
    weight:     newWeight,
    pieces:     newPieces,
    total_cost: recalc.total_cost,
    order_ids:  newOrderIds,
  };
  if (recalc.fuel_surcharge != null) shipPatch.fuel_surcharge = recalc.fuel_surcharge;
  if (recalc.accessorials   != null) shipPatch.accessorials   = recalc.accessorials;

  const shipAfter = await db.dbUpdate('shipments', shipmentId, shipPatch, tenantConfig);

  let orderAfter;
  try {
    orderAfter = await db.dbUpdate('orders', orderId, {
      shipment_id: shipmentId,
      status: 'Planned',
    }, tenantConfig);
  } catch (orderErr) {
    // Roll the shipment back so we don't end up with a ghost entry in order_ids.
    try {
      await db.dbUpdate('shipments', shipmentId, {
        weight:     shipBefore.weight,
        pieces:     shipBefore.pieces,
        total_cost: shipBefore.total_cost,
        order_ids:  existingOrderIds,
        fuel_surcharge: shipBefore.fuel_surcharge,
        accessorials:   shipBefore.accessorials,
      }, tenantConfig);
    } catch (_rollback) { /* best effort */ }
    throw orderErr;
  }

  // 5. REQ-02 history hooks — one 'plan' row for the order, plus 'edit'
  // rows on the shipment for changed totals. Best-effort; do not fail
  // the main operation if history write fails.
  try {
    await history.recordChange({
      entityType: 'order',
      entityId:   orderId,
      action:     'plan',
      user,
      metadata: {
        shipmentId,
        mode:     shipBefore.mode || null,
        carrier:  shipBefore.carrier || null,
        addedVia: 'manual-add-to-shipment',
      },
    });
    await history.recordFieldDiffs({
      entityType: 'shipment',
      entityId:   shipmentId,
      before: {
        weight:     shipBefore.weight,
        pieces:     shipBefore.pieces,
        total_cost: shipBefore.total_cost,
        order_ids:  existingOrderIds,
      },
      after: {
        weight:     newWeight,
        pieces:     newPieces,
        total_cost: recalc.total_cost,
        order_ids:  newOrderIds,
      },
      fields: { weight: 'weight', pieces: 'pieces', total_cost: 'total_cost', order_ids: 'order_ids' },
      user,
      metadata: { reason: 'order-added', addedOrderId: orderId, costRecalc: recalc.note, scale: recalc.scale },
    });
  } catch (auditErr) {
    console.error('[shipmentMutations] history write failed:', auditErr.message);
  }

  return {
    shipment: { ...shipAfter },
    order:    { ...orderAfter },
    recalc,  // includes scale, note, total_cost
    before: {
      shipment: {
        weight:     shipBefore.weight,
        pieces:     shipBefore.pieces,
        total_cost: shipBefore.total_cost,
        order_ids:  existingOrderIds,
      },
      order: {
        shipment_id: orderBefore.shipment_id,
        status:      orderBefore.status,
      },
    },
  };
}

// ── Recalculate shipment after an order is removed ────────────────
// Mirror of addOrderToShipment for the unassign path. Called by the
// PATCH /api/orders/:id route after the order's shipment_id has been
// cleared, when the shipment still has remaining orders (i.e. orphan
// cleanup did NOT delete it).
//
// Reuses recalcCost() so add and remove paths share identical
// proportional-scaling math against the existing weight, pieces,
// total_cost, fuel_surcharge, and accessorials columns. No schema
// changes (zoree_db_rules).
async function recalcShipmentAfterOrderRemoval({
  shipmentId,
  removedOrderId,
  user = null,
  tenantConfig = null,
}) {
  if (!shipmentId) { const e = new Error('shipmentId is required'); e.status = 400; throw e; }

  const shipRows = await db.dbSelect('shipments', {
    filters: [['id', 'eq', shipmentId]], limit: 1,
  }, tenantConfig);
  const shipBefore = Array.isArray(shipRows) && shipRows.length ? shipRows[0] : null;
  if (!shipBefore) return null; // shipment was deleted by orphan cleanup — nothing to do.

  const remaining = await db.dbSelect('orders', {
    filters: [['shipment_id', 'eq', shipmentId]], limit: 500,
  }, tenantConfig);
  const remainingRows = Array.isArray(remaining) ? remaining : [];

  const newWeight = remainingRows.reduce((s, o) => s + num(o.weight), 0);
  const newPieces = remainingRows.reduce((s, o) => s + num(o.pieces), 0);
  const remainingIds = remainingRows.map((o) => o.id);

  const recalc = recalcCost({
    oldWeight: shipBefore.weight,
    oldCost:   shipBefore.total_cost,
    newWeight,
    oldFsc: shipBefore.fuel_surcharge ?? null,
    oldAcc: shipBefore.accessorials ?? null,
  });

  const shipPatch = {
    weight:     newWeight,
    pieces:     newPieces,
    total_cost: recalc.total_cost,
    order_ids:  remainingIds,
  };
  if (recalc.fuel_surcharge != null) shipPatch.fuel_surcharge = recalc.fuel_surcharge;
  if (recalc.accessorials   != null) shipPatch.accessorials   = recalc.accessorials;

  const shipAfter = await db.dbUpdate('shipments', shipmentId, shipPatch, tenantConfig);

  try {
    await history.recordFieldDiffs({
      entityType: 'shipment',
      entityId:   shipmentId,
      before: {
        weight:         shipBefore.weight,
        pieces:         shipBefore.pieces,
        total_cost:     shipBefore.total_cost,
        fuel_surcharge: shipBefore.fuel_surcharge,
        accessorials:   shipBefore.accessorials,
        order_ids:      Array.isArray(shipBefore.order_ids) ? shipBefore.order_ids : [],
      },
      after: {
        weight:         newWeight,
        pieces:         newPieces,
        total_cost:     recalc.total_cost,
        fuel_surcharge: recalc.fuel_surcharge,
        accessorials:   recalc.accessorials,
        order_ids:      remainingIds,
      },
      fields: {
        weight: 'weight',
        pieces: 'pieces',
        total_cost: 'total_cost',
        fuel_surcharge: 'fuel_surcharge',
        accessorials: 'accessorials',
        order_ids: 'order_ids',
      },
      user,
      metadata: { reason: 'order-removed', removedOrderId, costRecalc: recalc.note, scale: recalc.scale },
    });
  } catch (auditErr) {
    console.error('[shipmentMutations] history write failed (recalc on removal):', auditErr.message);
  }

  return { shipment: shipAfter, recalc };
}

// ── Change carrier on an existing shipment ────────────────────────
// Single writer for the "🔄 Change Carrier" flow. Replaces the previous
// component-level DbApi.patch("shipments", id, ...) call which bypassed
// the audit/broadcast pipeline (REQ-02) and produced the stale-display
// bug where the Shipment Details modal showed the previous carrier
// after a successful change.
//
// Responsibilities:
//   1. Read the current shipment row (so we can write a real before/after
//      audit and validate state).
//   2. Reject the change if the shipment is in a locked status.
//   3. Write only the carrier + rate-related columns (no opportunistic
//      schema drift — we do not touch fields outside the allow-list).
//   4. Record one change_history row per actually-changed field via
//      recordFieldDiffs so the History tab attributes the carrier
//      switch to the user that performed it.
//   5. Emit SHIPMENT_UPDATED on the in-process bus → wsBroadcast, so
//      every connected TMS client (and the Shipments Page list) re-reads
//      without a manual refresh.
//
// Accepts a partial `payload`; only keys present in ALLOWED_FIELDS are
// written. Empty / missing fields fall back to the current row, with the
// exception of `carrier` itself, which is required.
const ALLOWED_CARRIER_CHANGE_FIELDS = [
  'carrier',
  'mode',
  'total_cost',
  'rate',
  'fuel_surcharge',
  'miles',
  'service_level',
  'rate_id',
  // The next two are what kept the Shipment Details modal showing
  // stale "Equipment (from rate)", "Rate ID", and "Transit Days" after a
  // carrier change: changing carriers shifts to a different rate row,
  // and unless we snapshot the new rate's equipment and recompute the
  // delivery date, the UI keeps deriving them from the previous rate.
  'equipment',
  'delivery_date',
];

function pickAllowed(payload) {
  const out = {};
  for (const key of ALLOWED_CARRIER_CHANGE_FIELDS) {
    if (payload[key] === undefined) continue;
    out[key] = payload[key];
  }
  return out;
}

async function changeShipmentCarrier({ shipmentId, payload = {}, user = null, tenantConfig = null }) {
  if (!shipmentId) { const e = new Error('shipmentId is required'); e.status = 400; throw e; }
  const carrier = (payload.carrier == null ? '' : String(payload.carrier)).trim();
  if (!carrier) { const e = new Error('carrier is required'); e.status = 400; throw e; }

  // 1. Read current shipment.
  const rows = await db.dbSelect('shipments', {
    filters: [['id', 'eq', shipmentId]], limit: 1,
  }, tenantConfig);
  const before = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!before) { const e = new Error(`Shipment not found: ${shipmentId}`); e.status = 404; throw e; }

  // 2. Lifecycle gate.
  if (CARRIER_CHANGE_LOCKED_STATUSES.has(before.status)) {
    const e = new Error(`Shipment ${shipmentId} is ${before.status}; carrier cannot be changed`);
    e.status = 409; throw e;
  }

  // 3. Build the patch — only the allow-listed fields, with the new
  //    carrier guaranteed present (already validated above).
  const patch = pickAllowed({ ...payload, carrier });

  const after = await db.dbUpdate('shipments', shipmentId, patch, tenantConfig);

  // 4. Audit — one row per changed field. recordFieldDiffs handles the
  //    equality normalization so we don't write phantom rows.
  try {
    await history.recordFieldDiffs({
      entityType: 'shipment',
      entityId:   shipmentId,
      before,
      after: { ...before, ...patch },
      fields: {
        carrier:        'carrier',
        mode:           'mode',
        total_cost:     'total_cost',
        rate:           'rate',
        fuel_surcharge: 'fuel_surcharge',
        miles:          'miles',
        service_level:  'service_level',
        rate_id:        'rate_id',
        equipment:      'equipment',
        delivery_date:  'delivery_date',
      },
      user,
      metadata: { reason: 'change-carrier', via: 'shipment-change-carrier' },
    });
  } catch (auditErr) {
    console.error('[shipmentMutations] change-carrier history write failed:', auditErr.message);
  }

  // 5. Real-time fan-out to every TMS client.
  try {
    bus.emit(EVENTS.SHIPMENT_UPDATED, {
      id:           shipmentId,
      carrier:      patch.carrier,
      mode:         patch.mode || before.mode,
      total_cost:   patch.total_cost != null ? patch.total_cost : before.total_cost,
      via:          'change-carrier',
    });
  } catch (busErr) {
    console.error('[shipmentMutations] change-carrier broadcast failed:', busErr.message);
  }

  return { shipment: after || { ...before, ...patch }, before, patch };
}

module.exports = {
  addOrderToShipment,
  recalcShipmentAfterOrderRemoval,
  recalcCost,
  changeShipmentCarrier,
  _internal: { LOCKED_STATUSES, CARRIER_CHANGE_LOCKED_STATUSES, ALLOWED_CARRIER_CHANGE_FIELDS },
};
ost,
      via:          'change-carrier',
    });
  } catch (busErr) {
    console.error('[shipmentMutations] change-carrier broadcast failed:', busErr.message);
  }

  return { shipment: after || { ...before, ...patch }, before, patch };
}

module.exports = {
  addOrderToShipment,
  recalcShipmentAfterOrderRemoval,
  recalcCost,
  changeShipmentCarrier,
  _internal: { LOCKED_STATUSES, CARRIER_CHANGE_LOCKED_STATUSES, ALLOWED_CARRIER_CHANGE_FIELDS },
};
