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
  const beforeRows = await db.dbSelect('shipments', {
    filters: [['id', 'eq', shipmentId]], limit: 1,
    select: 'id,status,order_ids,carrier,seal_number,pickup_date,delivery_date',
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
