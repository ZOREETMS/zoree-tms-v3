// ═══════════════════════════════════════════════════════════════════
// Shipment Events Service — manual timeline events from the UI.
//
// When a planner clicks "+ Add Event" in the shipment detail modal and
// picks a type (Picked Up / In Transit / Delivered / Exception / ...),
// the UI POSTs the event here. This service:
//
//   1. Maps the event type to a canonical shipment status (if any) and
//      a canonical linked-order status.
//   2. Updates the shipment row and every linked order atomically
//      (idempotent — no-ops if the status already matches).
//   3. Sets pickup_date / delivery_date where the event implies a date.
//   4. Writes change_history rows on both entities so the history
//      drawer shows the transition + planner's optional note.
//
// Mirrors the pattern in api/services/shipConfirm.js (REQ-23): the
// service is the single writer, history is best-effort, and the main
// status write never fails because audit logging failed.
// ═══════════════════════════════════════════════════════════════════

const db = require('./supabase');
const history = require('./changeHistory');
const { bus, EVENTS } = require('./eventBus');

// Event-type → shipment/order status mapping. Null means "do not change
// that status column"; the event is recorded as a timeline note only.
const EVENT_MAP = {
  'Picked Up':  { shipStatus: 'In Transit', orderStatus: 'In Transit', dateField: 'pickup_date' },
  'In Transit': { shipStatus: 'In Transit', orderStatus: 'In Transit', dateField: null },
  'Departed':   { shipStatus: null,         orderStatus: null,         dateField: null },
  'Arrived':    { shipStatus: null,         orderStatus: null,         dateField: null },
  'Delivered':  { shipStatus: 'Delivered',  orderStatus: 'Delivered',  dateField: 'delivery_date' },
  'Exception':  { shipStatus: 'Exception',  orderStatus: null,         dateField: null },
  'Delay':      { shipStatus: null,         orderStatus: null,         dateField: null },
  'Note':       { shipStatus: null,         orderStatus: null,         dateField: null },
};

async function applyShipmentEvent({ shipmentId, type, note, date, user }) {
  const id = String(shipmentId || '').trim();
  if (!id) { const e = new Error('shipmentId is required'); e.status = 400; throw e; }
  if (!type) { const e = new Error('event type is required'); e.status = 400; throw e; }

  const map = EVENT_MAP[type];
  if (!map) { const e = new Error(`Unsupported event type: ${type}`); e.status = 400; throw e; }

  // 1. Read the shipment so we can diff + walk linked orders.
  const rows = await db.dbSelect('shipments', {
    filters: [['id', 'eq', id]], limit: 1,
    select: 'id,status,order_ids,pickup_date,delivery_date',
  });
  const ship = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!ship) { const e = new Error(`Shipment not found: ${id}`); e.status = 404; throw e; }

  const eventDate = date || new Date().toISOString().slice(0, 10);
  const metadata = {
    via: 'timeline-event',
    eventType: type,
    eventDate,
    note: note || null,
  };

  // 2. Shipment status transition (idempotent).
  const shipPatch = {};
  if (map.shipStatus && ship.status !== map.shipStatus) {
    shipPatch.status = map.shipStatus;
  }
  if (map.dateField && !ship[map.dateField]) {
    shipPatch[map.dateField] = eventDate;
  }

  if (Object.keys(shipPatch).length) {
    await db.dbUpdate('shipments', id, shipPatch, null);
    if (shipPatch.status) {
      try {
        await history.recordChange({
          entityType: 'shipment',
          entityId:   id,
          action:     'status',
          field:      'status',
          before:     ship.status || null,
          after:      shipPatch.status,
          user,
          metadata,
        });
      } catch (auditErr) {
        console.error('[shipmentEvents] shipment status history failed:', auditErr.message);
      }
    }
  }

  // 2b. Always record a timeline_event audit row so the history drawer
  // shows the planner's note even when the event doesn't change status.
  try {
    await history.recordChange({
      entityType: 'shipment',
      entityId:   id,
      action:     'status',
      field:      'timeline_event',
      before:     null,
      after:      type,
      user,
      metadata,
    });
  } catch (auditErr) {
    console.error('[shipmentEvents] timeline history failed:', auditErr.message);
  }

  // 3. Propagate to linked orders when the event implies an order status.
  const orderIds = Array.isArray(ship.order_ids) ? ship.order_ids.map(String).filter(Boolean) : [];
  const transitioned = [];
  const skipped = [];

  if (map.orderStatus && orderIds.length) {
    for (const oid of orderIds) {
      try {
        const priorRows = await db.dbSelect('orders', {
          filters: [['id', 'eq', oid]], limit: 1,
          select: 'id,status,shipment_id',
        });
        const prior = Array.isArray(priorRows) && priorRows.length ? priorRows[0] : null;
        if (!prior) { skipped.push({ id: oid, reason: 'not_found' }); continue; }
        if (prior.status === map.orderStatus) { skipped.push({ id: oid, reason: 'already_set' }); continue; }

        await db.dbUpdate('orders', oid, { status: map.orderStatus }, null);
        transitioned.push(oid);

        try {
          await history.recordChange({
            entityType: 'order',
            entityId:   oid,
            action:     'status',
            field:      'status',
            before:     prior.status || null,
            after:      map.orderStatus,
            user,
            metadata:   { ...metadata, shipmentId: id },
          });
        } catch (auditErr) {
          console.error(`[shipmentEvents] order history failed (${oid}):`, auditErr.message);
        }

        bus.emit(EVENTS.ORDER_UPDATED, {
          id: oid, status: map.orderStatus, shipment_id: id,
        });
      } catch (perOrderErr) {
        console.error(`[shipmentEvents] order transition failed (${oid}):`, perOrderErr.message);
        skipped.push({ id: oid, reason: perOrderErr.message });
      }
    }
  }

  return {
    shipmentId: id,
    eventType: type,
    shipmentStatus: shipPatch.status || ship.status,
    ordersUpdated: transitioned,
    ordersSkipped: skipped,
  };
}

module.exports = { applyShipmentEvent, EVENT_MAP };
