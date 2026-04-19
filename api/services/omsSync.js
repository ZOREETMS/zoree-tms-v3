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
        skipped.push({ id: oid, reason: 'no_oms_row' });
        continue;
      }
      const patch = { ...baseUpdates };
      // Only advance stage if we're currently < 6 (Tender Confirmed).
      if ((prior.stage || 0) < 6) patch.stage = 6;

      await db.dbUpdate('oms_orders', oid, patch, null);
      updated.push(oid);
    } catch (perOrderErr) {
      console.error(`[omsSync] row update failed for ${oid}:`, perOrderErr.message);
      skipped.push({ id: oid, reason: perOrderErr.message });
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

  return { shipmentId, pushedAt: nowIso, updated, skipped };
}

module.exports = { syncTenderAcceptToOms };
