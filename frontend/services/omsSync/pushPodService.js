// frontend/services/omsSync/pushPodService.js
// ---------------------------------------------------------------------------
// OMS → TMS: push Stage-11 POD / "Delivered" status updates.
// Replaces the inline runPushPODFlow() that previously lived in
// zoree-middleware.html. Only selects rows where tms_pod_pushed_at IS NULL
// (migration 023 — supersedes mistargeted 010) so the auto-sync cycle
// does not re-push the same POD every tick.
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

  // Routes through the TMS API ingest endpoint (api/routes/ingest.js
  // → applyShipmentEvent('Delivered')) so the API can:
  //   • Write change_history rows for the shipment + each linked order
  //     (status → 'Delivered', metadata.via = 'timeline-event'),
  //     populating the Delivered rung's timestamp without row-fallback.
  //   • Emit SHIPMENT_UPDATED + ORDER_UPDATED on the bus → wsBroadcast,
  //     so open TMS pages flip live without a refresh.
  //   • Stamp delivery_date on the shipment row (idempotent).
  // Direct DB writes from the browser skipped all of that.
  async function updateTmsToDelivered(tmsApiBase, ingestKey, omsRow) {
    var url = String(tmsApiBase || '').replace(/\/+$/, '') + '/ingest/oms-pod';
    var headers = { 'Content-Type': 'application/json' };
    if (ingestKey) headers['X-API-Key'] = ingestKey;
    // Compose a short note from the POD condition / receiver so the audit
    // row carries the OMS-captured detail forward into the TMS history drawer.
    var noteParts = [];
    if (omsRow.pod_received_by) noteParts.push('POD by: ' + omsRow.pod_received_by);
    if (omsRow.pod_condition)   noteParts.push('Condition: ' + omsRow.pod_condition);
    if (omsRow.pod_notes)       noteParts.push(String(omsRow.pod_notes));
    var body = {
      shipmentId:  omsRow.tms_shipment_id,
      deliveredAt: omsRow.delivered_at || null,
      note:        noteParts.length ? noteParts.join(' · ') : null,
      source:      'oms-wms',
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

  async function runPushPod(deps) {
    var omsDb        = deps.omsDb;
    var tmsApiBase   = deps.tmsApiBase;
    var ingestKey    = deps.ingestKey || null;
    var logEvent     = deps.logEvent;
    var payloadBytes = deps.payloadBytes;
    var notifyTMS    = deps.notifyTMS;

    if (!tmsApiBase) {
      throw new Error('pushPodService: deps.tmsApiBase is required (set MW_CONFIG.tmsApi).');
    }

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
      var upd = await updateTmsToDelivered(tmsApiBase, ingestKey, o);

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
