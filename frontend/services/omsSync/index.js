// frontend/services/omsSync/index.js
// ---------------------------------------------------------------------------
// Entry point for the OMS↔TMS sync service layer. Load this file AFTER the
// individual *Service.js files — it finalises the namespace and exposes:
//
//   window.ZoreeMW.services.omsSync.pushOrder.run(deps)
//   window.ZoreeMW.services.omsSync.pushShip.run(deps)
//   window.ZoreeMW.services.omsSync.pushPod.run(deps)
//   window.ZoreeMW.services.omsSync.buildDefaultNotify(url)
//
// The middleware HTML builds a `deps` object once and passes it to each run.
// ---------------------------------------------------------------------------

(function (global) {
  'use strict';

  var ns = global.ZoreeMW = global.ZoreeMW || {};
  ns.services = ns.services || {};
  ns.services.omsSync = ns.services.omsSync || {};

  var required = ['tracking', 'pushOrder', 'pushShip', 'pushPod'];
  for (var i = 0; i < required.length; i++) {
    if (!ns.services.omsSync[required[i]]) {
      throw new Error(
        'ZoreeMW omsSync: ' + required[i] + ' module is missing. ' +
        'Check <script> load order in zoree-middleware.html.'
      );
    }
  }

  // Default WebSocket notifier — fires a non-blocking POST to the TMS API.
  // Middleware passes this in as `deps.notifyTMS` so services stay DI-pure.
  function buildDefaultNotify(notifyUrl) {
    return function notifyTMS(event, data) {
      try {
        fetch(notifyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: event, data: data }),
        }).catch(function () { /* non-blocking */ });
      } catch (_) { /* non-blocking */ }
    };
  }

  ns.services.omsSync.buildDefaultNotify = buildDefaultNotify;
  ns.services.omsSync.VERSION = '1.0.0';
})(typeof window !== 'undefined' ? window : globalThis);
