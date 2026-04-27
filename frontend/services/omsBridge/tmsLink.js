// frontend/services/omsBridge/tmsLink.js
// ---------------------------------------------------------------------------
// OMS→TMS deep-link service. Single source of truth for resolving the TMS
// React app URL and navigating to a specific shipment from the OMS HTML
// (zoree-oms.html). Extracted out of the OMS monolith so:
//
//   - URL construction lives in one place (fixes drift between BOL / PRO /
//     TMS REF cells that all need to point at /shipments?id=<SHP_ID>).
//   - The navigation primitive can change (window.location.assign vs
//     window.open vs in-app modal) without touching the row template
//     scattered across the HTML.
//   - Tests / dev-tools can stub OmsTmsLink.openShipment without monkey-
//     patching window.location.
//
// Design:
//   - No framework deps. Plain window-global module so zoree-oms.html can
//     load it via <script src="...">. Mirrors the existing omsWsClient
//     pattern (see services/omsLive/omsWsClient.js).
//   - Uses window.location.assign (same-tab navigation) — invisible to
//     popup-blocker extensions (uBlock, AdGuard, Brave Shields), which
//     only intercept window.open and target="_blank" clicks. Earlier
//     iterations using either of those primitives reliably hit
//     about:blank#blocked in the user's browser.
//
// Public API:
//   OmsTmsLink.buildShipmentUrl(shipmentId) → string
//   OmsTmsLink.openShipment(shipmentId)     → void  (navigates current tab)
//   OmsTmsLink.setBaseUrl(url)              → void  (persists override)
//   OmsTmsLink.getBaseUrl()                 → string
// ---------------------------------------------------------------------------

(function (root) {
  'use strict';

  var STORAGE_KEY = 'zoree_tms_app_url';

  /** Resolve the TMS app base URL — operator override (localStorage) wins,
   *  otherwise fall back to the current origin so single-port deployments
   *  (vite dev, shared nginx) work without setup. */
  function getBaseUrl() {
    var override = '';
    try { override = root.localStorage && root.localStorage.getItem(STORAGE_KEY); } catch (e) {}
    var origin = (root.location && root.location.origin) || '';
    return String(override || origin || '').replace(/\/$/, '');
  }

  /** Persist the operator-configured TMS app URL. Pass an empty string to
   *  clear the override and fall back to same-origin. */
  function setBaseUrl(url) {
    try {
      if (url) root.localStorage.setItem(STORAGE_KEY, String(url));
      else     root.localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }

  /** Build the deep-link URL for a TMS shipment. Returns "" when the id is
   *  blank so callers can short-circuit. */
  function buildShipmentUrl(shipmentId) {
    var id = String(shipmentId || '').trim();
    if (!id) return '';
    return getBaseUrl() + '/shipments?id=' + encodeURIComponent(id);
  }

  /** Navigate the current tab to the linked TMS shipment. The TMS app's
   *  ShipmentsPage useEffect reads the ?id= query param and auto-opens the
   *  Shipment Details modal, then replaceState's the URL back to
   *  /shipments. Best-effort console-log so click receipt is observable
   *  during ad-blocker debugging. */
  function openShipment(shipmentId) {
    var href = buildShipmentUrl(shipmentId);
    if (!href) return;
    try { (root.console && root.console.log) && root.console.log('[OMS→TMS] navigating to', href); } catch (e) {}
    if (root.location && typeof root.location.assign === 'function') {
      root.location.assign(href);
    } else {
      // Defensive: if location is missing for some reason, fall back to
      // direct href assignment (still a same-tab navigation).
      try { root.location.href = href; } catch (e) {}
    }
  }

  root.OmsTmsLink = {
    buildShipmentUrl: buildShipmentUrl,
    openShipment:     openShipment,
    getBaseUrl:       getBaseUrl,
    setBaseUrl:       setBaseUrl,
  };
})(typeof window !== 'undefined' ? window : this);
