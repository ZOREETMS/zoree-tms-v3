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
//   4. Writes EXACTLY ONE change_history row per planner click — the
//      OMS-sync metadata (pushedAt, omsRowsUpdated, podReceivedBy, …) is
//      folded into the same row instead of producing a second STATUS
//      entry. The duplicate-row bug fixed two iterations ago lived
//      here.
//
// Mirrors the pattern in api/services/shipConfirm.js (REQ-23): the
// service is the single writer, history is best-effort, and the main
// status write never fails because audit logging failed.
// ═══════════════════════════════════════════════════════════════════

const db = require('./supabase');
const history = require('./changeHistory');
const { bus, EVENTS } = require('./eventBus');
// Messaging Hub (migration 042) — surface carrier operational milestones
// (Picked Up / In Transit / Arrived / Exception / …) as inbound
// CARRIER_EVENT messages. Best-effort; never fails the status write.
const hubWriter = require('./messagingHub/writer');
const { MESSAGE_TYPE, SYSTEM_PARTY } = require('./messagingHub/types');

// Event types that represent a carrier-reported operational milestone
// worth logging to the hub. 'Note' is a free-text annotation, not a
// carrier event, so it's excluded.
const HUB_CARRIER_EVENT_TYPES = new Set([
  'Picked Up', 'In Transit', 'Departed', 'Arrived', 'Delivered', 'Exception', 'Delay',
]);

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

const SHIPMENT_STATUS_TO_ORDER_STATUS = {
  // Tender lifecycle added 2026-08-11: before this, a bot/API accept set
  // shipments.status='Tender Accepted' but left orders untouched, while
  // the web accept path set orders and left the shipment 'Tendered' —
  // two mutually inconsistent representations of the same event. Every
  // status-PATCH path (updateShipment, recordRawPatchAudit) consults
  // this map, so mapping the two tender states here converges them all.
  // Order-side date freezing still applies: 'Tender Accepted' is in
  // POST_TENDER_ACCEPT_STATUSES, and this sync writes ONLY the status
  // column — ready/due dates are user intent and are never touched.
  'Tendered':        'Tendered',
  'Tender Accepted': 'Tender Accepted',
  'In Transit':      'In Transit',
  'Delivered':       'Delivered',
};

const ORDER_TERMINAL_STATUSES = new Set(['Delivered', 'Cancelled']);

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

  const rows = await db.dbSelect('shipments', {
    filters: [['id', 'eq', id]], limit: 1,
    select: 'id,status,order_ids,pickup_date,delivery_date,shipped_at,delivered_at',
  });
  const ship = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!ship) { const e = new Error(`Shipment not found: ${id}`); e.status = 404; throw e; }

  const eventDate = date || new Date().toISOString().slice(0, 10);
  const baseMetadata = {
    via: 'timeline-event',
    eventType: type,
    eventDate,
    note: note || null,
  };

  // ── Step 2: Shipment status transition (idempotent). DATA write only;
  // history is deferred to step 5 so we can fold OMS-sync metadata into
  // the same row instead of writing a duplicate.
  const shipPatch = {};
  if (map.shipStatus && ship.status !== map.shipStatus) {
    shipPatch.status = map.shipStatus;
  }
  if (map.dateField && !ship[map.dateField]) {
    shipPatch[map.dateField] = eventDate;
  }
  if (map.tsField && shipPatch.status && !ship[map.tsField]) {
    shipPatch[map.tsField] = new Date().toISOString();
  }

  if (Object.keys(shipPatch).length) {
    await db.dbUpdate('shipments', id, shipPatch, null);
  }

  // ── Step 3: Propagate to linked orders.
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

  // ── Step 4: Mirror Delivered to OMS. syncDeliveredToOms no longer
  // writes its own change_history row; it returns audit metadata that
  // we fold into our consolidated row in step 5.
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

  // ── Step 5: ONE consolidated change_history row per planner click.
  // Folds OMS-sync metadata (pushedAt, rowsUpdated, etc.) into the same
  // row as the status diff so the History tab does not show two
  // side-by-side STATUS entries for one click.
  const omsAuditMetadata =
    omsSync && (omsSync.updated.length > 0 || omsSync.skipped.length > 0)
      ? {
          omsRowsUpdated:   omsSync.updated.length,
          omsRowsSkipped:   omsSync.skipped.length,
          omsPushedAt:      omsSync.pushedAt || null,
          omsDeliveredAt:   omsSync.deliveredAt || null,
          omsPodReceivedBy: omsSync.podReceivedBy || null,
          omsOrderIds:      omsSync.updated,
        }
      : null;
  const consolidatedMetadata = omsAuditMetadata
    ? { ...baseMetadata, ...omsAuditMetadata }
    : baseMetadata;

  if (shipPatch.status) {
    // Status actually changed — record a status-diff row.
    try {
      await history.recordChange({
        entityType: 'shipment',
        entityId:   id,
        action:     'status',
        field:      'status',
        before:     ship.status || null,
        after:      shipPatch.status,
        user,
        metadata:   consolidatedMetadata,
      });
    } catch (auditErr) {
      console.error('[shipmentEvents] shipment status history failed:', auditErr.message);
    }
  } else {
    // Status didn't change (note-only event OR replay of a Delivered on
    // an already-Delivered shipment that force-resyncs OMS). Single
    // timeline_event row carries the audit footprint.
    try {
      await history.recordChange({
        entityType: 'shipment',
        entityId:   id,
        action:     'status',
        field:      'timeline_event',
        before:     null,
        after:      type,
        user,
        metadata:   consolidatedMetadata,
      });
    } catch (auditErr) {
      console.error('[shipmentEvents] timeline history failed:', auditErr.message);
    }
  }

  // ── Messaging Hub hook (migration 042): record the carrier milestone
  // as an inbound CARRIER → TMS message. Distinct from the TMS → OMS
  // DELIVERED notification emitted by omsSync — this captures the carrier
  // *reporting* the event. Best-effort; never affects the status write.
  if (HUB_CARRIER_EVENT_TYPES.has(type)) {
    try {
      await hubWriter.recordInbound({
        messageType: MESSAGE_TYPE.CARRIER_EVENT,
        source:      SYSTEM_PARTY.CARRIER,
        target:      SYSTEM_PARTY.TMS,
        payload: {
          shipmentId:     id,
          eventType:      type,
          eventDate,
          note:           note || null,
          shipmentStatus: shipPatch.status || ship.status || null,
          ordersUpdated:  transitioned,
        },
        shipmentId:  id,
        externalRef: type,
        actor:       (user && (user.email || user.name)) || 'carrier-event',
        tenantId:    user && user.tenantId,
      });
    } catch (hubErr) {
      console.error('[shipmentEvents] hub carrier-event write failed:', hubErr.message);
    }
  }

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
    shipmentPatch: {
      status:        shipPatch.status        || ship.status,
      pickup_date:   shipPatch.pickup_date   || ship.pickup_date   || null,
      delivery_date: shipPatch.delivery_date || ship.delivery_date || null,
    },
    ordersUpdated: transitioned,
    ordersSkipped: skipped,
    omsSync,
  };
}

module.exports = {
  applyShipmentEvent,
  syncLinkedOrdersForShipmentStatus,
  EVENT_MAP,
  SHIPMENT_STATUS_TO_ORDER_STATUS,
};
