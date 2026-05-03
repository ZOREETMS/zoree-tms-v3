// ═══════════════════════════════════════════════════════════════════
// OMS Sync Service — REQ-24.
//
// Runs the "middleware job" that mirrors a TMS tender-accept into the
// OMS oms_orders table, automatically, the moment the tender is
// accepted. No cron, no manual push button, no OMS_API_URL needed —
// the sync is inline and deterministic because the OMS and TMS share
// the same Supabase project (oms_orders lives right next to the TMS
// orders / shipments tables).
//
// Called from POST /api/oms/push, which itself is fired by the TMS
// confirmAcceptTender() handler the instant the carrier accept is
// recorded. The flow:
//
//   TMS UI → confirmAcceptTender() → OmsApi.push(...)
//          → POST /api/oms/push  (this service)
//          → UPSERT oms_orders rows for every linked order
//          → change_history row on the shipment  (REQ-20 drawer)
//
// The existing /api/oms/push also forwards to OMS_API_URL if the env
// variable is set; the inline sync below runs either way so the OMS
// database view is always current without operator intervention.
// ═══════════════════════════════════════════════════════════════════

const db = require('./supabase');
const history = require('./changeHistory');
const { bus, EVENTS } = require('./eventBus');

// Classify a PG / Supabase error so the caller can surface a useful
// reason to the UI instead of opaque raw text. Keys are stable strings
// the frontend can switch on.
function classifyDbError(err) {
  const code = err && (err.code || err.pgCode || '');
  const msg  = String(err && err.message || err || '').toLowerCase();
  if (code === '42703' || msg.includes('column') && msg.includes('does not exist')) return 'column_missing';
  if (code === '42P01' || msg.includes('relation') && msg.includes('does not exist')) return 'table_missing';
  if (code === '42501' || msg.includes('permission denied') || msg.includes('not authorized')) return 'permission_denied';
  if (msg.includes('network') || msg.includes('fetch failed') || msg.includes('timeout'))    return 'network';
  return 'other';
}

// Push shipment details onto every oms_orders row that belongs to
// the shipment. Returns per-order status for the caller to surface.
async function syncTenderAcceptToOms(payload, user) {
  const shipmentId = String(payload?.shipmentId || '').trim();
  if (!shipmentId) { const e = new Error('shipmentId is required'); e.status = 400; throw e; }

  const orderIds = Array.isArray(payload.orderIds) ? payload.orderIds.map(String).filter(Boolean) : [];
  const nowIso = new Date().toISOString();

  // Normalize the fields we intend to mirror into oms_orders. Only write
  // non-empty values so we don't blow away data the OMS may already
  // have captured through its own UI (e.g. dock door assigned at
  // staging time).
  const setIf = (obj, key, val) => {
    if (val === undefined || val === null) return;
    if (typeof val === 'string' && val.trim() === '') return;
    obj[key] = val;
  };
  const baseUpdates = { updated_at: nowIso };
  setIf(baseUpdates, 'tms_shipment_id',           shipmentId);
  setIf(baseUpdates, 'carrier',                   payload.carrier);
  setIf(baseUpdates, 'service_level',             payload.serviceLevel);
  setIf(baseUpdates, 'bol_number',                payload.bolNumber);
  setIf(baseUpdates, 'pro_number',                payload.proNumber);
  setIf(baseUpdates, 'seal_number',               payload.sealNumber);
  setIf(baseUpdates, 'pickup_date',               payload.pickupDate);
  setIf(baseUpdates, 'estimated_delivery',        payload.deliveryDate);
  setIf(baseUpdates, 'dock_door',                 payload.dockNumber);
  // Migration 027: mirror the TMS-side dock loading window so the OMS
  // warehouse modals (Pick / Pack / Stage / Ship) can show pickup
  // start/end without a TMS round-trip.
  setIf(baseUpdates, 'loading_start',             payload.dockLoadStart);
  setIf(baseUpdates, 'loading_end',               payload.dockLoadEnd);
  // Time-stamp columns the OMS uses to track MW sync state.
  baseUpdates.tendered_at                = nowIso;
  baseUpdates.tms_ship_status_pushed_at  = nowIso;

  const updated = [];
  const skipped = [];

  for (const oid of orderIds) {
    try {
      // Read the current OMS row so we can (a) confirm it exists and
      // (b) never regress the stage — OMS stages 7/8/9/10 mean pick/
      // pack/stage/ship already happened; we don't want to rewind to 6.
      const priorRows = await db.dbSelect('oms_orders', {
        filters: [['id', 'eq', oid]], limit: 1,
        select: 'id,stage',
      });
      const prior = Array.isArray(priorRows) && priorRows.length ? priorRows[0] : null;
      if (!prior) {
        // OMS row doesn't exist yet — common for orders created directly
        // in TMS (no OMS origin). Skip silently; the tender-accept still
        // lives on the TMS shipment and REQ-21 can pull it on demand.
        skipped.push({ id: oid, reason: 'no_oms_row', detail: 'no matching oms_orders row (likely TMS-origin order)' });
        continue;
      }
      const patch = { ...baseUpdates };
      // Only advance stage if we're currently < 6 (Tender Confirmed).
      if ((prior.stage || 0) < 6) patch.stage = 6;

      await db.dbUpdate('oms_orders', oid, patch, null);
      updated.push(oid);
    } catch (perOrderErr) {
      const reason = classifyDbError(perOrderErr);
      console.error(`[omsSync] row update failed for ${oid} (${reason}):`, perOrderErr.message);
      skipped.push({ id: oid, reason, detail: perOrderErr.message });
    }
  }

  // REQ-20: drop a per-shipment audit row so the Shipment Change History
  // drawer surfaces that the MW auto-sync fired. Best-effort only.
  try {
    await history.recordChange({
      entityType: 'shipment',
      entityId:   shipmentId,
      action:     'status',
      field:      'oms_sync',
      before:     null,
      after:      'synced',
      user:       user || { email: 'mw-auto-sync' },
      metadata: {
        via: 'tms-tender-accept-auto-sync',
        omsRowsUpdated: updated.length,
        omsRowsSkipped: skipped.length,
        orderIds: orderIds,
        carrier: payload.carrier || null,
        serviceLevel: payload.serviceLevel || null,
        bolNumber: payload.bolNumber || null,
        proNumber: payload.proNumber || null,
        sealNumber: payload.sealNumber || null,
        pickupDate: payload.pickupDate || null,
        deliveryDate: payload.deliveryDate || null,
        dockDoor: payload.dockNumber || null,
        pushedAt: nowIso,
      },
    });
  } catch (auditErr) {
    console.error('[omsSync] history write failed:', auditErr.message);
  }

  // Aggregate skipped reasons so callers (API/UI) can surface a single
  // headline like "3 orders skipped — column_missing: run migration 023"
  // instead of re-doing the bucketing on the frontend.
  const skippedByReason = skipped.reduce((acc, s) => {
    const k = s.reason || 'other';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  // Broadcast so live-sync clients refresh the second the OMS mirror
  // lands. server.js bridges SHIPMENT_UPDATED to wsBroadcast, which the
  // OMS Sales Orders page picks up via OmsLive (see zoree-oms.html:1098)
  // and the TMS pages pick up via wsClient.js. Without this, the OMS UI
  // would stay on "Released to TMS" until a manual refresh — exactly the
  // failure mode reported for SHP-2026-6004 / ORD-140058.
  if (updated.length) {
    try {
      bus.emit(EVENTS.SHIPMENT_UPDATED, {
        id:              shipmentId,
        via:             'tms-tender-accept-auto-sync',
        carrier:         payload.carrier || null,
        omsRowsUpdated:  updated,
        omsRowsSkipped:  skipped.map((s) => s.id),
        pushedAt:        nowIso,
      });
    } catch (busErr) {
      console.error('[omsSync] tender-accept broadcast failed:', busErr.message);
    }
  }

  return { shipmentId, pushedAt: nowIso, updated, skipped, skippedByReason };
}

// Mirror a TMS "Delivered" timeline event into every linked oms_orders
// row. Called from api/services/shipmentEvents.js after the TMS-side
// shipment + orders transition to 'Delivered' commits. Same contract as
// syncTenderAcceptToOms: inline UPDATE, no external API hop, per-order
// skip reasons, idempotent (never regresses stage).
//
// Payload shape:
//   { shipmentId, orderIds: [...], deliveredAt?, note?, podReceivedBy? }
async function syncDeliveredToOms(payload, user) {
  const shipmentId = String(payload?.shipmentId || '').trim();
  if (!shipmentId) { const e = new Error('shipmentId is required'); e.status = 400; throw e; }

  const orderIds = Array.isArray(payload.orderIds) ? payload.orderIds.map(String).filter(Boolean) : [];
  const nowIso = new Date().toISOString();
  // deliveredAt may be a YYYY-MM-DD (from the timeline event's `date`
  // field) or a full ISO timestamp. Normalize to ISO so the OMS column
  // (TIMESTAMPTZ) accepts it without a cast round-trip.
  const rawDelivered = payload.deliveredAt || payload.deliveryDate || nowIso;
  const deliveredIso = /^\d{4}-\d{2}-\d{2}$/.test(String(rawDelivered))
    ? new Date(`${rawDelivered}T00:00:00Z`).toISOString()
    : new Date(rawDelivered).toISOString();

  const updated = [];
  const skipped = [];

  for (const oid of orderIds) {
    try {
      const priorRows = await db.dbSelect('oms_orders', {
        filters: [['id', 'eq', oid]], limit: 1,
        select: 'id,stage,delivered_at,tms_pod_pushed_at',
      });
      const prior = Array.isArray(priorRows) && priorRows.length ? priorRows[0] : null;
      if (!prior) {
        // No OMS origin row — TMS-native order. Nothing to mirror.
        skipped.push({ id: oid, reason: 'no_oms_row', detail: 'no matching oms_orders row (likely TMS-origin order)' });
        continue;
      }

      const patch = {
        delivered_at:        deliveredIso,
        tms_pod_pushed_at:   nowIso,
        updated_at:          nowIso,
      };
      // Stage 11 = Delivered. Never regress (an OMS row already past 11
      // has extra post-delivery state we shouldn't rewind).
      if ((prior.stage || 0) < 11) patch.stage = 11;
      // Best-effort POD metadata. Only written when the caller supplied
      // a value so we don't clobber OMS-side edits (e.g. consignee
      // signature captured at the dock).
      if (payload.note)           patch.pod_notes        = String(payload.note);
      if (payload.podReceivedBy)  patch.pod_received_by  = String(payload.podReceivedBy);

      await db.dbUpdate('oms_orders', oid, patch, null);
      updated.push(oid);
    } catch (perOrderErr) {
      const reason = classifyDbError(perOrderErr);
      console.error(`[omsSync.delivered] row update failed for ${oid} (${reason}):`, perOrderErr.message);
      skipped.push({ id: oid, reason, detail: perOrderErr.message });
    }
  }

  // History row is no longer written here. Caller folds the returned
  // audit metadata into its own consolidated change_history row so the
  // planner's "Mark Delivered" produces exactly one row instead of
  // two side-by-side STATUS entries (the duplicate-OMS-row bug).

  const skippedByReason = skipped.reduce((acc, s) => {
    const k = s.reason || 'other';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  return {
    shipmentId,
    pushedAt: nowIso,
    deliveredAt: deliveredIso,
    note: payload.note || null,
    podReceivedBy: payload.podReceivedBy || null,
    via: 'tms-delivered-auto-sync',
    updated,
    skipped,
    skippedByReason,
  };
}

// Mirror dock-assignment changes from the TMS shipment back into every
// linked oms_orders row. Called whenever shipments.dock_door (and the
// associated dock_time / loading_start / loading_end) is written
// outside the tender-accept flow — bulk-plan execute, multi-stop route
// planning, dock-scheduling drag-and-drop, etc.
//
// Why a dedicated helper:
//   - syncTenderAcceptToOms only fires on tender-accept; if the dock is
//     assigned later the OMS Load & Ship modal would otherwise show
//     "DOCK # —" because oms_orders.dock_door is never refreshed.
//   - Keeps the dock-mirror logic in one place so callers (services) do
//     not embed UPDATE statements inline (Rule 6: services-first).
//
// Payload shape:
//   { shipmentId, orderIds?: [...], dockDoor?, dockTime?,
//     loadingStart?, loadingEnd? }
//
// Behavior:
//   - Only the supplied dock fields are written; everything else on the
//     OMS row is preserved.
//   - If orderIds is omitted the helper looks up linked orders from the
//     orders table (orders.shipment_id = shipmentId).
//   - Stage is never advanced or rewound — this is a metadata mirror.
//   - Best-effort audit row + SHIPMENT_UPDATED broadcast, mirroring the
//     other sync helpers.
async function syncDockToOms(payload, user) {
  const shipmentId = String(payload?.shipmentId || '').trim();
  if (!shipmentId) { const e = new Error('shipmentId is required'); e.status = 400; throw e; }

  // Build the patch from whichever dock fields the caller supplied.
  // Empty strings and null/undefined are skipped so we never blow away
  // a value the OMS already had.
  const nowIso = new Date().toISOString();
  const dockPatch = { updated_at: nowIso };
  const setIf = (obj, key, val) => {
    if (val === undefined || val === null) return;
    if (typeof val === 'string' && val.trim() === '') return;
    obj[key] = val;
  };
  setIf(dockPatch, 'dock_door',     payload.dockDoor);
  setIf(dockPatch, 'dock_time',     payload.dockTime);
  setIf(dockPatch, 'loading_start', payload.loadingStart);
  setIf(dockPatch, 'loading_end',   payload.loadingEnd);

  // Nothing to mirror? Bail early — keeps callers from having to gate
  // on "did anything change" themselves.
  if (Object.keys(dockPatch).length <= 1) {
    return { shipmentId, pushedAt: nowIso, updated: [], skipped: [], skippedByReason: {}, noop: true };
  }

  // Resolve order IDs. Caller may pass them explicitly (preferred — avoids
  // a round-trip), otherwise we look them up via orders.shipment_id.
  let orderIds = Array.isArray(payload.orderIds) ? payload.orderIds.map(String).filter(Boolean) : [];
  if (!orderIds.length) {
    try {
      const linked = await db.dbSelect('orders', {
        filters: [['shipment_id', 'eq', shipmentId]],
        select: 'id', limit: 500,
      });
      orderIds = (linked || []).map((r) => String(r.id)).filter(Boolean);
    } catch (lookupErr) {
      console.error('[omsSync.dock] order lookup failed:', lookupErr.message);
      return { shipmentId, pushedAt: nowIso, updated: [], skipped: [], skippedByReason: { lookup_failed: 1 } };
    }
  }
  if (!orderIds.length) {
    return { shipmentId, pushedAt: nowIso, updated: [], skipped: [], skippedByReason: {}, noop: true };
  }

  const updated = [];
  const skipped = [];

  for (const oid of orderIds) {
    try {
      const priorRows = await db.dbSelect('oms_orders', {
        filters: [['id', 'eq', oid]], limit: 1,
        select: 'id,stage,dock_door,dock_time,loading_start,loading_end',
      });
      const prior = Array.isArray(priorRows) && priorRows.length ? priorRows[0] : null;
      if (!prior) {
        // TMS-origin order with no OMS row — nothing to mirror.
        skipped.push({ id: oid, reason: 'no_oms_row', detail: 'no matching oms_orders row (likely TMS-origin order)' });
        continue;
      }
      await db.dbUpdate('oms_orders', oid, dockPatch, null);
      updated.push(oid);
    } catch (perOrderErr) {
      const reason = classifyDbError(perOrderErr);
      console.error(`[omsSync.dock] row update failed for ${oid} (${reason}):`, perOrderErr.message);
      skipped.push({ id: oid, reason, detail: perOrderErr.message });
    }
  }

  // REQ-20: drop a per-shipment audit row so the Shipment Change History
  // drawer surfaces that the dock-mirror auto-sync fired. Best-effort.
  if (updated.length) {
    try {
      await history.recordChange({
        entityType: 'shipment',
        entityId:   shipmentId,
        action:     'status',
        field:      'oms_dock_sync',
        before:     null,
        after:      'synced',
        user:       user || { email: 'mw-auto-sync' },
        metadata: {
          via: 'tms-dock-assigned-auto-sync',
          omsRowsUpdated: updated.length,
          omsRowsSkipped: skipped.length,
          orderIds,
          dockDoor:     payload.dockDoor     || null,
          dockTime:     payload.dockTime     || null,
          loadingStart: payload.loadingStart || null,
          loadingEnd:   payload.loadingEnd   || null,
          pushedAt: nowIso,
        },
      });
    } catch (auditErr) {
      console.error('[omsSync.dock] history write failed:', auditErr.message);
    }
  }

  const skippedByReason = skipped.reduce((acc, s) => {
    const k = s.reason || 'other';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  // Broadcast so the OMS Sales Orders page (OmsLive in zoree-oms.html)
  // and any open TMS tabs refresh without a manual reload — same channel
  // the tender-accept and delivered mirrors use.
  if (updated.length) {
    try {
      bus.emit(EVENTS.SHIPMENT_UPDATED, {
        id:              shipmentId,
        via:             'tms-dock-assigned-auto-sync',
        omsRowsUpdated:  updated,
        omsRowsSkipped:  skipped.map((s) => s.id),
        pushedAt:        nowIso,
      });
    } catch (busErr) {
      console.error('[omsSync.dock] broadcast failed:', busErr.message);
    }
  }

  return { shipmentId, pushedAt: nowIso, updated, skipped, skippedByReason };
}

module.exports = { syncTenderAcceptToOms, syncDeliveredToOms, syncDockToOms, classifyDbError };
