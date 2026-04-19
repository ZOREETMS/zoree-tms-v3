// frontend/services/omsSync/pushPodService.js
// ---------------------------------------------------------------------------
// OMS → TMS: push Stage-11 POD / "Delivered" status updates.
// Replaces the inline runPushPODFlow() that previously lived in
// zoree-middleware.html. Only selects rows where tms_pod_pushed_at IS NULL
// (migration 010) so the auto-sync cycle does not re-push the same POD
// every tick.
// ---------------------------------------------------------------------------

(function (global) {
  'use strict';

  var ns = (global.ZoreeMW = global.ZoreeMW || {});
  ns.services = ns.services || {};
  ns.services.omsSync = ns.services.omsSync || {};

  var tracking = ns.services.omsSync.tracking;
  if (!tracking) {
    throw new Error(
      'pushPodService.js must be loaded AFTER omsSyncTracking.js'
    );
  }

  // ── IO ────────────────────────────────────────────────────────────────

  async function fetchPendingPods(omsDb) {
    return omsDb().from('oms_orders')
      .select('id,tms_shipment_id,delivered_at,pod_received_by,pod_condition,pod_notes')
      .eq('stage', 11)
      .not('tms_shipment_id', 'is', null)
      .is('tms_pod_pushed_at', null);
  }

  async function updateTmsToDelivered(tmsDb, omsRow) {
    var shipUpd = { status: 'Delivered' };
    var r1 = await tmsDb().from('shipments').update(shipUpd).eq('id', omsRow.tms_shipment_id);
    var r2 = await tmsDb().from('orders').update({ status: 'Delivered' }).eq('id', omsRow.id);
    return { error: r1.error || r2.error, shipUpd: shipUpd };
  }

  // ── Orchestration ─────────────────────────────────────────────────────

  async function runPushPod(deps) {
    var omsDb        = deps.omsDb;
    var tmsDb        = deps.tmsDb;
    var logEvent     = deps.logEvent;
    var payloadBytes = deps.payloadBytes;
    var notifyTMS    = deps.notifyTMS;

    var res = await fetchPendingPods(omsDb);
    if (res.error) throw res.error;

    var data = res.data || [];
    if (!data.length) {
      logEvent('info', 'push-pod', 'No stage-11 PODs pending TMS delivery push');
      return '0';
    }

    logEvent('info', '← OMS', 'Read ' + data.length + ' stage-11 POD record(s) to notify TMS', {
      srcSystem: 'OMS', dstSystem: 'TMS',
      rowCount: data.length,
      bytes:    payloadBytes(data),
      fields:   ['id','tms_shipment_id','delivered_at','pod_received_by','pod_condition'],
      payload:  data,
    });

    var pushed = 0;
    for (var i = 0; i < data.length; i++) {
      var o = data[i];
      var upd = await updateTmsToDelivered(tmsDb, o);

      if (!upd.error) {
        await tracking.stampPodPushed(omsDb, o.id);
        pushed++;
        logEvent('ok', '→ TMS',
          'PUSH Delivered: shipment ' + o.tms_shipment_id +
          ' | POD by: ' + (o.pod_received_by || '?') +
          ' | condition: ' + (o.pod_condition || '?'),
          {
            srcSystem: 'OMS', dstSystem: 'TMS',
            recordId:  o.tms_shipment_id,
            rowCount:  1,
            bytes:     payloadBytes(upd.shipUpd),
            fields:    Object.keys(upd.shipUpd),
            payload: {
              _meta:         { flow: 'push-pod', omsOrderId: o.id, pushedAt: new Date().toISOString() },
              _writtenToTMS: {
                shipments: { id: o.tms_shipment_id, update: upd.shipUpd },
                orders:    { id: o.id, status: 'Delivered' },
              },
              _sourceOMS:    {
                id:              o.id,
                delivered_at:    o.delivered_at,
                pod_received_by: o.pod_received_by,
                pod_condition:   o.pod_condition,
                pod_notes:       o.pod_notes,
              },
            },
          }
        );
      } else {
        logEvent('err', '→ TMS',
          'PUSH FAILED Delivered for ' + o.tms_shipment_id + ': ' + (upd.error.message || 'unknown'),
          { srcSystem: 'OMS', dstSystem: 'TMS', recordId: o.tms_shipment_id,
            payload: { error: upd.error.message, attempted: upd.shipUpd } }
        );
      }
    }

    if (pushed > 0 && typeof notifyTMS === 'function') {
      notifyTMS('shipment_delivered', { source: 'oms', count: pushed });
    }
    return pushed + ' delivery push(es)';
  }

  ns.services.omsSync.pushPod = { run: runPushPod };
})(typeof window !== 'undefined' ? window : globalThis);
