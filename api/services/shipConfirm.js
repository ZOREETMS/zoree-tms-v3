// ═══════════════════════════════════════════════════════════════════
// Ship-Confirm Service — REQ-23.
//
// Entry point for the OMS→TMS warehouse ship-out notification:
//   - OMS warehouse module finalises pick/pack/stage/load
//   - Middleware POSTs /api/ingest/oms-ship-confirm (see ingest route)
//   - This service transitions the linked TMS shipment + orders and
//     writes change_history rows on both sides so REQ-20's history
//     drawers show the ship-out event
//
// Design notes:
//   - Shipment → 'In Transit'. The shipment timeline already derives
//     `isPickedUp` from ds.status ∈ {In Transit, Delivered, Exception},
//     so setting 'In Transit' lights up the 🚛 Picked Up rung without
//     any new frontend plumbing.
//   - Orders → 'Shipped' (whitelist broadened by migration 017). Each
//     order that was linked to the shipment at confirm time is
//     transitioned; this is idempotent if called twice.
//   - All writes best-effort: history failures MUST NOT fail the
//     main DB status update so the warehouse flow still completes.
//   - Emits ORDER_UPDATED on the in-process bus so the TMS Orders
//     page refreshes live via REQ-01 SSE.
// ═══════════════════════════════════════════════════════════════════

const db = require('./supabase');
const history = require('./changeHistory');
const { bus, EVENTS } = require('./eventBus');

// Mirror BOL / PRO from the TMS shipment into the matching oms_orders row.
// Skips empty values so an unset field on the shipment can't blow away
// data the OMS captured through its own UI. Best-effort: a failure here
// MUST NOT fail the ship-confirm — the warehouse flow still has to complete.
async function mirrorBolPro(omsOrderId, ship, shippedAt) {
  try {
    const priorRows = await db.dbSelect('oms_orders', {
      filters: [['id', 'eq', omsOrderId]], limit: 1,
      select: 'id',
    });
    if (!priorRows || !priorRows.length) return; // TMS-origin order, no OMS row

    const setIf = (obj, key, val) => {
      if (val === undefined || val === null) return;
      if (typeof val === 'string' && val.trim() === '') return;
      obj[key] = val;
    };
    const patch = {
      updated_at: new Date().toISOString(),
      tms_ship_status_pushed_at: new Date().toISOString(),
    };
    setIf(patch, 'bol_number', ship.bol_number);
    setIf(patch, 'pro_number', ship.pro_number);
    setIf(patch, 'shipped_at', shippedAt);

    await db.dbUpdate('oms_orders', omsOrderId, patch, null);
  } catch (mirrorErr) {
    console.error(`[shipConfirm] oms BOL/PRO mirror failed (${omsOrderId}):`, mirrorErr.message);
  }
}

async function applyShipConfirm(body) {
  const shipmentId = String(body?.shipmentId || '').trim();
  if (!shipmentId) { const e = new Error('shipmentId is required'); e.status = 400; throw e; }

  const shippedAt = (body?.shippedAt && new Date(body.shippedAt).toISOString())
    || new Date().toISOString();
  const sealNumber = (body?.sealNumber != null && body.sealNumber !== '')
    ? String(body.sealNumber)
    : null;
  const source = body?.source || 'oms-wms';

  // 1. Read current shipment so we can emit a proper before/after history row.
  //    bol_number / pro_number are pulled so we can mirror them into oms_orders
  //    below — closing the gap where a BOL or PRO assigned to the TMS shipment
  //    *after* tender-accept (e.g. BOL doc generated at ship time, manual edit,
  //    carrier-supplied PRO) never reached the OMS.
  const beforeRows = await db.dbSelect('shipments', {
    filters: [['id', 'eq', shipmentId]], limit: 1,
    select: 'id,status,order_ids,carrier,seal_number,pickup_date,delivery_date,bol_number,pro_number',
  });
  const ship = Array.isArray(beforeRows) && beforeRows.length ? beforeRows[0] : null;
  if (!ship) {
    const e = new Error(`Shipment not found: ${shipmentId}`);
    e.status = 404; throw e;
  }

  // 2. Transition shipment. Idempotent: if already In Transit, skip the write.
  const shipPatch = { status: 'In Transit', shipped_at: shippedAt };
  if (sealNumber && !ship.seal_number) shipPatch.seal_number = sealNumber;

  if (ship.status !== 'In Transit') {
    await db.dbUpdate('shipments', shipmentId, shipPatch, null);
    try {
      await history.recordChange({
        entityType: 'shipment',
        entityId:   shipmentId,
        action:     'status',
        field:      'status',
        before:     ship.status || null,
        after:      'In Transit',
        user:       { email: source },
        metadata:   {
          via: 'oms-ship-confirm',
          shippedAt,
          sealNumber: sealNumber || ship.seal_number || null,
          source,
        },
      });
    } catch (auditErr) {
      console.error('[shipConfirm] shipment history write failed:', auditErr.message);
    }

    // Broadcast the shipment-level transition so the TMS Shipments page
    // (and any open detail modal) flip the Picked Up / In Transit rungs
    // live. server.js bridges this to wsBroadcast.
    bus.emit(EVENTS.SHIPMENT_UPDATED, {
      id:         shipmentId,
      status:     'In Transit',
      shipped_at: shippedAt,
      via:        'oms-ship-confirm',
    });
  }

  // 3. Transition every linked order. Prefer the explicit orderIds[] from
  //    the MW call when provided; otherwise fall back to the shipment's
  //    order_ids column.
  const explicit = Array.isArray(body?.orderIds) ? body.orderIds.map(String) : [];
  const fromShip = Array.isArray(ship.order_ids) ? ship.order_ids.map(String) : [];
  const orderIds = [...new Set([...(explicit.length ? explicit : fromShip)])].filter(Boolean);

  const transitioned = [];
  const skipped = [];

  for (const oid of orderIds) {
    try {
      const priorRows = await db.dbSelect('orders', {
        filters: [['id', 'eq', oid]], limit: 1,
        select: 'id,status,shipment_id',
      });
      const prior = Array.isArray(priorRows) && priorRows.length ? priorRows[0] : null;
      if (!prior) { skipped.push({ id: oid, reason: 'not_found' }); continue; }

      // Mirror BOL / PRO into the OMS row regardless of whether this is
      // the first ship-confirm or a re-trigger. Closes the gap where a
      // BOL / PRO is assigned on the TMS shipment after the original
      // ship-confirm (e.g. BOL doc generated post-pickup, carrier-supplied
      // PRO, manual edit) — re-firing ship-confirm now propagates it to
      // the OMS Sales Orders grid. setIf inside the helper skips empty
      // values so this is safe to run repeatedly.
      await mirrorBolPro(oid, ship, shippedAt);

      if (prior.status === 'Shipped') { skipped.push({ id: oid, reason: 'already_shipped' }); continue; }

      await db.dbUpdate('orders', oid, { status: 'Shipped' }, null);
      transitioned.push(oid);

      try {
        await history.recordChange({
          entityType: 'order',
          entityId:   oid,
          action:     'status',
          field:      'status',
          before:     prior.status || null,
          after:      'Shipped',
          user:       { email: source },
          metadata:   {
            via: 'oms-ship-confirm',
            shipmentId,
            shippedAt,
            source,
          },
        });
      } catch (auditErr) {
        console.error(`[shipConfirm] order history write failed (${oid}):`, auditErr.message);
      }

      // REQ-01: broadcast to SSE subscribers so open TMS Orders pages
      // flip the badge in real time — no refresh needed.
      bus.emit(EVENTS.ORDER_UPDATED, {
        id: oid, status: 'Shipped', shipment_id: shipmentId,
      });
    } catch (perOrderErr) {
      console.error(`[shipConfirm] order transition failed (${oid}):`, perOrderErr.message);
      skipped.push({ id: oid, reason: perOrderErr.message });
    }
  }

  return {
    shipmentId,
    shipmentStatus: 'In Transit',
    shippedAt,
    ordersShipped: transitioned,
    ordersSkipped: skipped,
  };
}

module.exports = { applyShipConfirm };
