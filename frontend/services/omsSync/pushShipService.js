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

  async function updateTmsToInTransit(tmsDb, omsRow) {
    var shipUpd = { status: 'In Transit' };
    var r1 = await tmsDb().from('shipments').update(shipUpd).eq('id', omsRow.tms_shipment_id);
    var r2 = await tmsDb().from('orders').update({ status: 'In Transit' }).eq('id', omsRow.id);
    return { error: r1.error || r2.error, shipUpd: shipUpd };
  }

  // ── Orchestration ─────────────────────────────────────────────────────

  async function runPushShip(deps) {
    var omsDb        = deps.omsDb;
    var tmsDb        = deps.tmsDb;
    var logEvent     = deps.logEvent;
    var payloadBytes = deps.payloadBytes;
    var notifyTMS    = deps.notifyTMS;

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
      var upd = await updateTmsToInTransit(tmsDb, o);

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

    if (pushed > 0 && typeof notifyTMS === 'function') {
      notifyTMS('shipment_status_updated', { source: 'oms', count: pushed });
    }
    return pushed + ' status push(es)';
  }

  ns.services.omsSync.pushShip = { run: runPushShip };
})(typeof window !== 'undefined' ? window : globalThis);
