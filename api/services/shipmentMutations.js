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

// Shipment statuses where no further orders may be added. Keep in sync
// with any front-end assertion on shipment lifecycle.
const LOCKED_STATUSES = new Set(['Delivered', 'Cancelled']);

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

module.exports = { addOrderToShipment, recalcShipmentAfterOrderRemoval, recalcCost, _internal: { LOCKED_STATUSES } };
