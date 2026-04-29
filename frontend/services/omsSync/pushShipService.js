// frontend/services/omsSync/pushShipService.js
// ---------------------------------------------------------------------------
// OMS → TMS: push Stage-10 "In Transit" status updates.
// Replaces the inline runPushShipFlow() that previously lived in
// zoree-middleware.html. Only selects rows where tms_ship_status_pushed_at
// IS NULL (migration 023 — supersedes mistargeted 010) so the auto-sync
// cycle does not re-push the same shipment status every tick.
// ---------------------------------------------------------------------------

(function (global) {
  'use strict';

  var ns = (global.ZoreeMW = global.ZoreeMW || {});
  ns.services = ns.services || {};
  ns.services.omsSync = ns.services.omsSync || {};

  var tracking = ns.services.omsSync.tracking;
  if (!tracking) {
    throw new Error(
      'pushShipService.js must be loaded AFTER omsSyncTracking.js'
    );
  }

  // ── IO ────────────────────────────────────────────────────────────────

  async function fetchPendingShipStatuses(omsDb) {
    return omsDb().from('oms_orders')
      .select('id,tms_shipment_id,shipped_at,ship_date,seal_number,carrier')
      .eq('stage', 10)
      .not('tms_shipment_id', 'is', null)
      .is('tms_ship_status_pushed_at', null);
  }

  // Routes through the TMS API ingest endpoint instead of writing the
  // status directly into the shipments / orders tables. The API handler
  // (api/services/shipConfirm.js) is the single writer for this transition,
  // which is what makes the audit-row + live-refresh story work:
  //   • change_history rows are written for shipment + each linked order,
  //     so the timeline derivation finds real "Picked Up" / "In Transit"
  //     timestamps instead of falling back to "Confirmed".
  //   • bus.emit(SHIPMENT_UPDATED) → wsBroadcast, so any open TMS detail
  //     modal flips its rungs live without a manual refresh.
  //   • mirrorBolPro propagates BOL / PRO back to the OMS row for free.
  // Direct DB writes from the browser bypassed all three.
  async function updateTmsToInTransit(tmsApiBase, ingestKey, omsRow) {
    var url = String(tmsApiBase || '').replace(/\/+$/, '') + '/ingest/oms-ship-confirm';
    var headers = { 'Content-Type': 'application/json' };
    if (ingestKey) headers['X-API-Key'] = ingestKey;
    var body = {
      shipmentId: omsRow.tms_shipment_id,
      orderIds:   [omsRow.id],
      shippedAt:  omsRow.shipped_at || null,
      sealNumber: omsRow.seal_number || null,
      source:     'oms-wms',
    };
    try {
      var res = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body) });
      var json = null;
      try { json = await res.json(); } catch (_) { json = null; }
      if (!res.ok) {
        var msg = (json && (json.error || json.message)) || ('HTTP ' + res.status);
        return { error: { message: msg }, shipUpd: body };
      }
      return { error: null, shipUpd: body, response: json };
    } catch (err) {
      return { error: { message: err.message || 'fetch failed' }, shipUpd: body };
    }
  }

  // ── Orchestration ─────────────────────────────────────────────────────

  async function runPushShip(deps) {
    var omsDb        = deps.omsDb;
    var tmsApiBase   = deps.tmsApiBase;
    var ingestKey    = deps.ingestKey || null;
    var logEvent     = deps.logEvent;
    var payloadBytes = deps.payloadBytes;
    // notifyTMS is no longer needed: applyShipConfirm emits SHIPMENT_UPDATED
    // on the API bus, which the wsBroadcast bridge already fans out to TMS
    // clients. Sending an extra notify from here would double-broadcast.
    if (!tmsApiBase) {
      throw new Error('pushShipService: deps.tmsApiBase is required (set MW_CONFIG.tmsApi).');
    }

    var res = await fetchPendingShipStatuses(omsDb);
    if (res.error) throw res.error;

    var data = res.data || [];
    if (!data.length) {
      logEvent('info', 'push-ship', 'No stage-10 shipments pending TMS status push');
      return '0';
    }

    logEvent('info', '← OMS', 'Read ' + data.length + ' stage-10 shipped order(s) to notify TMS', {
      srcSystem: 'OMS', dstSystem: 'TMS',
      rowCount: data.length,
      bytes:    payloadBytes(data),
      fields:   ['id','tms_shipment_id','shipped_at','carrier'],
      payload:  data,
    });

    var pushed = 0;
    for (var i = 0; i < data.length; i++) {
      var o = data[i];
      var upd = await updateTmsToInTransit(tmsApiBase, ingestKey, o);

      if (!upd.error) {
        await tracking.stampShipStatusPushed(omsDb, o.id);
        pushed++;
        logEvent('ok', '→ TMS',
          'PUSH In Transit: shipment ' + o.tms_shipment_id + ' + order ' + o.id,
          {
            srcSystem: 'OMS', dstSystem: 'TMS',
            recordId:  o.tms_shipment_id,
            rowCount:  1,
            bytes:     payloadBytes(upd.shipUpd),
            fields:    Object.keys(upd.shipUpd),
            payload: {
              _meta:           { flow: 'push-ship', omsOrderId: o.id, pushedAt: new Date().toISOString() },
              _writtenToTMS:   {
                shipments: { id: o.tms_shipment_id, update: upd.shipUpd },
                orders:    { id: o.id, status: 'In Transit' },
              },
              _sourceOMS:      { id: o.id, shipped_at: o.shipped_at, carrier: o.carrier },
            },
          }
        );
      } else {
        logEvent('err', '→ TMS',
          'PUSH FAILED In Transit for ' + o.tms_shipment_id + ': ' + (upd.error.message || 'unknown'),
          { srcSystem: 'OMS', dstSystem: 'TMS', recordId: o.tms_shipment_id,
            payload: { error: upd.error.message, attempted: upd.shipUpd } }
        );
      }
    }

    return pushed + ' status push(es)';
  }

  ns.services.omsSync.pushShip = { run: runPushShip };
})(typeof window !== 'undefined' ? window : globalThis);
