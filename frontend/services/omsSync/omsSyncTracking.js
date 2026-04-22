// frontend/services/omsSync/omsSyncTracking.js
// ---------------------------------------------------------------------------
// Owns the three "last pushed to TMS" timestamp columns introduced in
// migration 023_req24_oms_push_tracking_columns.sql (supersedes the
// mistargeted 010_oms_add_tms_push_tracking.sql, which was never
// applied — its header wrongly declared a separate "OMS Supabase
// project" even though oms_orders and orders share one project per
// migration 011). The middleware auto-sync
// services call into these helpers instead of writing to oms_orders directly,
// so there is a single, auditable place that touches push-tracking state.
//
// Dependencies are injected — no globals, no window access — so these
// helpers are unit-testable with a stub Supabase client.
// ---------------------------------------------------------------------------

(function (global) {
  'use strict';

  function nowIso() { return new Date().toISOString(); }

  async function _stamp(omsDb, orderId, column) {
    if (!omsDb || typeof omsDb !== 'function') {
      throw new Error('omsSyncTracking: omsDb factory is required');
    }
    if (!orderId) {
      throw new Error('omsSyncTracking: orderId is required');
    }
    var update = {};
    update[column] = nowIso();
    return omsDb().from('oms_orders').update(update).eq('id', orderId);
  }

  async function stampOrderPushed(omsDb, orderId) {
    return _stamp(omsDb, orderId, 'tms_order_pushed_at');
  }

  async function stampShipStatusPushed(omsDb, orderId) {
    return _stamp(omsDb, orderId, 'tms_ship_status_pushed_at');
  }

  async function stampPodPushed(omsDb, orderId) {
    return _stamp(omsDb, orderId, 'tms_pod_pushed_at');
  }

  var api = {
    stampOrderPushed:      stampOrderPushed,
    stampShipStatusPushed: stampShipStatusPushed,
    stampPodPushed:        stampPodPushed,
  };

  global.ZoreeMW = global.ZoreeMW || {};
  global.ZoreeMW.services = global.ZoreeMW.services || {};
  global.ZoreeMW.services.omsSync = global.ZoreeMW.services.omsSync || {};
  global.ZoreeMW.services.omsSync.tracking = api;
})(typeof window !== 'undefined' ? window : globalThis);
