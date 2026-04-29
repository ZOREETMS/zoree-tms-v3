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
//   - dateField: the planned-date column (pickup_date / delivery_date)
//   - tsField:   the actual-timestamp column (shipped_at / delivered_at).
//                Populating this is what gives the Picked Up / Delivered
//                rungs in the timeline a real timestamp without relying
//                on a change_history derivation. Mirrors what
//                shipConfirm.js already does for the OMS ship-confirm path.
const EVENT_MAP = {
  'Picked Up':  { shipStatus: 'In Transit', orderStatus: 'In Transit', dateField: 'pickup_date',  tsField: 'shipped_at'   },
  'In Transit': { shipStatus: 'In Transit', orderStatus: 'In Transit', dateField: null,            tsField: 'shipped_at'   },
  'Departed':   { shipStatus: null,         orderStatus: null,         dateField: null,            tsField: null            },
  'Arrived':    { shipStatus: null,         orderStatus: null,         dateField: null,            tsField: null            },
  'Delivered':  { shipStatus: 'Delivered',  orderStatus: 'Delivered',  dateField: 'delivery_date', tsField: 'delivered_at' },
  'Exception':  { shipStatus: 'Exception',  orderStatus: null,         dateField: null,            tsField: null            },
  'Delay':      { shipStatus: null,         orderStatus: null,         dateField: null,            tsField: null            },
  'Note':       { shipStatus: null,         orderStatus: null,         dateField: null,            tsField: null            },
};

// Single source of truth for shipment-status → linked-order-status.
// Any writer that changes `shipments.status` must call
// syncLinkedOrdersForShipmentStatus so the order row doesn't drift.
// Terminal states on the order side (Delivered, Cancelled) are never
// regressed by this sync — they can only move forward.
const SHIPMENT_STATUS_TO_ORDER_STATUS = {
  'In Transit': 'In Transit',
  'Delivered':  'Delivered',
};

const ORDER_TERMINAL_STATUSES = new Set(['Delivered', 'Cancelled']);

// Propagate a shipment's new status to every linked order, idempotent
// and safe to call from any writer (event timeline, direct PATCH,
// ship-confirm, future webhooks). Returns { updated, skipped } so the
// caller can surface the diff to the UI.
async function syncLinkedOrdersForShipmentStatus({ shipmentId, newStatus, user, via, extraMetadata }) {
  const id = String(shipmentId || '').trim();
  if (!id) { const e = new Error('shipmentId is required'); e.status = 400; throw e; }

  const targetOrderStatus = SHIPMENT_STATUS_TO_ORDER_STATUS[newStatus];
  if (!targetOrderStatus) return { updated: [], skipped: [] };

  const shipRows = await db.dbSelect('shipments', {
    filters: [['id', 'eq', id]], limit: 1,
    select: 'id,order_ids',
  });
  const ship = Array.isArray(shipRows) && shipRows.length ? shipRows[0] : null;
  if (!ship) return { updated: [], skipped: [] };

  const orderIds = Array.isArray(ship.order_ids) ? ship.order_ids.map(String).filter(Boolean) : [];
  if (!orderIds.length) return { updated: [], skipped: [] };

  const metadata = {
    via: via || 'shipment-status-sync',
    shipmentId: id,
    shipmentStatus: newStatus,
    ...(extraMetadata || {}),
  };
  const updated = [];
  const skipped = [];

  for (const oid of orderIds) {
    try {
      const priorRows = await db.dbSelect('orders', {
        filters: [['id', 'eq', oid]], limit: 1,
        select: 'id,status,shipment_id',
      });
      const prior = Array.isArray(priorRows) && priorRows.length ? priorRows[0] : null;
      if (!prior)                                       { skipped.push({ id: oid, reason: 'not_found' });    continue; }
      if (prior.status === targetOrderStatus)           { skipped.push({ id: oid, reason: 'already_set' });  continue; }
      if (ORDER_TERMINAL_STATUSES.has(prior.status))    { skipped.push({ id: oid, reason: 'terminal' });     continue; }

      await db.dbUpdate('orders', oid, { status: targetOrderStatus }, null);
      updated.push(oid);

      try {
        await history.recordChange({
          entityType: 'order',
          entityId:   oid,
          action:     'status',
          field:      'status',
          before:     prior.status || null,
          after:      targetOrderStatus,
          user,
          metadata,
        });
      } catch (auditErr) {
        console.error(`[shipmentEvents] order history failed (${oid}):`, auditErr.message);
      }

      bus.emit(EVENTS.ORDER_UPDATED, { id: oid, status: targetOrderStatus, shipment_id: id });
    } catch (perOrderErr) {
      console.error(`[shipmentEvents] order transition failed (${oid}):`, perOrderErr.message);
      skipped.push({ id: oid, reason: perOrderErr.message });
    }
  }

  return { updated, skipped };
}

async function applyShipmentEvent({ shipmentId, type, note, date, user }) {
  const id = String(shipmentId || '').trim();
  if (!id) { const e = new Error('shipmentId is required'); e.status = 400; throw e; }
  if (!type) { const e = new Error('event type is required'); e.status = 400; throw e; }

  const map = EVENT_MAP[type];
  if (!map) { const e = new Error(`Unsupported event type: ${type}`); e.status = 400; throw e; }

  // 1. Read the shipment so we can diff + walk linked orders. shipped_at
  //    and delivered_at are pulled so the tsField stamp below is a no-op
  //    when the column is already set (idempotent re-firing of the same
  //    event must not rewrite a real warehouse timestamp).
  const rows = await db.dbSelect('shipments', {
    filters: [['id', 'eq', id]], limit: 1,
    select: 'id,status,order_ids,pickup_date,delivery_date,shipped_at,delivered_at',
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
  // Stamp the actual-timestamp column only when this event is a fresh
  // status transition (skip on already-set events so a planner replay
  // doesn't rewrite a real warehouse timestamp). The supplied `date`
  // arrives as YYYY-MM-DD; we use NOW() instead so the timeline rung
  // shows when the event actually fired, not the calendar day.
  if (map.tsField && shipPatch.status && !ship[map.tsField]) {
    shipPatch[map.tsField] = new Date().toISOString();
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

  // 3. Propagate to linked orders via the shared sync helper. We pass
  //    the mapped shipment status so the helper can derive the canonical
  //    order status from the single source of truth.
  let transitioned = [];
  let skipped = [];
  if (map.orderStatus && map.shipStatus) {
    const result = await syncLinkedOrdersForShipmentStatus({
      shipmentId: id,
      newStatus:  map.shipStatus,
      user,
      via:        'timeline-event',
      extraMetadata: { eventType: type, eventDate, note: note || null },
    });
    transitioned = result.updated;
    skipped = result.skipped;
  }

  // 4. Mirror a "Delivered" transition onto oms_orders so the OMS sees
  //    the POD without a middleware round-trip. Same pattern as the
  //    tender-accept auto-sync (REQ-24). Best-effort: OMS failure must
  //    not roll back the TMS transition that already committed.
  //    Skip when the event originated from the OMS itself
  //    (/api/ingest/oms-pod → user.email === 'oms-wms') — otherwise we
  //    round-trip the POD right back onto its source and write a
  //    spurious audit row.
  // Key the OMS sync off the event TYPE (not the status transition),
  // so a planner can re-add a Delivered event to force-sync an OMS row
  // that was previously missed (stage 10 + tms_pod_pushed_at=null).
  // Without this, shipments already marked Delivered in TMS would have
  // no way to trigger the mirror after the fact.
  const fromOmsIngest = String(user?.email || '').toLowerCase() === 'oms-wms';
  let omsSync = { updated: [], skipped: [], skippedByReason: {} };
  if (type === 'Delivered' && !fromOmsIngest) {
    try {
      const omsSyncSvc = require('./omsSync');
      const linkedOrderIds = Array.isArray(ship.order_ids)
        ? ship.order_ids.map(String).filter(Boolean)
        : [];
      if (linkedOrderIds.length) {
        omsSync = await omsSyncSvc.syncDeliveredToOms({
          shipmentId:     id,
          orderIds:       linkedOrderIds,
          deliveredAt:    shipPatch.delivery_date || ship.delivery_date || eventDate,
          note:           note || null,
          podReceivedBy:  (user && (user.name || user.email)) || null,
        }, user);
      }
    } catch (omsErr) {
      console.error('[shipmentEvents] OMS delivered sync failed:', omsErr.message);
    }
  }

  // 5. Broadcast a refresh signal to every connected client (TMS + OMS)
  //    whenever this event caused any visible change — shipment row,
  //    linked-order rows, or oms_orders rows. Used to gate this on
  //    `shipPatch.status` only, but a planner re-adding a Delivered
  //    event on an already-Delivered shipment force-syncs the OMS row
  //    (see step 4 comment) without changing shipment.status, so the
  //    OMS would otherwise sit stale until a manual refresh. Emit at
  //    the end with the post-write state so listeners always see the
  //    final values regardless of which branch ran.
  const anythingChanged =
    Object.keys(shipPatch).length > 0 ||
    transitioned.length > 0 ||
    (omsSync && Array.isArray(omsSync.updated) && omsSync.updated.length > 0);
  if (anythingChanged) {
    bus.emit(EVENTS.SHIPMENT_UPDATED, {
      id,
      status:        shipPatch.status        || ship.status,
      pickup_date:   shipPatch.pickup_date   || ship.pickup_date   || null,
      delivery_date: shipPatch.delivery_date || ship.delivery_date || null,
      via:           'timeline-event',
      eventType:     type,
      ordersUpdated: transitioned,
      omsUpdated:    (omsSync && omsSync.updated) || [],
    });
  }

  return {
    shipmentId: id,
    eventType: type,
    shipmentStatus: shipPatch.status || ship.status,
    // Full set of fields that moved on the shipment row so the UI can
    // merge them into its local copy without a full re-fetch and without
    // closing the detail modal.
    shipmentPatch: {
      status:        shipPatch.status        || ship.status,
      pickup_date:   shipPatch.pickup_date   || ship.pickup_date   || null,
      delivery_date: shipPatch.delivery_date || ship.delivery_date || null,
    },
    ordersUpdated: transitioned,
    ordersSkipped: skipped,
    // REQ-24 parity with tender-accept: surface OMS mirror outcome so
    // the UI can show "X of Y synced to OMS" after the planner adds a
    // Delivered event.
    omsSync,
  };
}

module.exports = {
  applyShipmentEvent,
  syncLinkedOrdersForShipmentStatus,
  EVENT_MAP,
  SHIPMENT_STATUS_TO_ORDER_STATUS,
};
