// frontend/services/omsLive/omsWsClient.js
// ---------------------------------------------------------------------------
// Lightweight WebSocket client for the OMS HTML app. Subscribes to the
// TMS API's broadcast channel (ws://host:3001) so OMS can live-refresh the
// order list the moment TMS fires a tender_accepted / shipment_status_updated
// / shipment_delivered event — no more stale "Released to TMS" rows after a
// tender is accepted upstream.
//
// Design:
//   - No framework deps. Plain window-global module so zoree-oms.html can
//     load it via <script src="...">.
//   - Auto-reconnect with exponential backoff (cap at 30s) so a bounced
//     API server recovers on its own.
//   - Pure dispatcher: delegates UI work to the caller via `onEvent`.
//     This module never touches the DOM or the OMS data arrays — keeps the
//     services layer clean (CLAUDE_RULES §1, §4).
//
// Public API:
//   OmsLive.start({ wsUrl?, onEvent, onStatusChange? }) → { stop }
//   OmsLive.stop()
//
// Events broadcast by the TMS API (see api/server.js wsBroadcast):
//   - tender_accepted           { shipmentId, proNumber, orderIds }
//   - orders_updated            { source, count }
//   - shipment_status_updated   { source, count }
//   - shipment_delivered        { source, count }
// ---------------------------------------------------------------------------

(function (global) {
  'use strict';

  var MIN_BACKOFF_MS = 1000;
  var MAX_BACKOFF_MS = 30000;

  var state = {
    ws:              null,
    onEvent:         null,
    onStatusChange:  null,
    wsUrl:           null,
    backoffMs:       MIN_BACKOFF_MS,
    reconnectTimer:  null,
    stopped:         false,
  };

  function log(msg) {
    try { console.log('[OmsLive] ' + msg); } catch (_) { /* ignore */ }
  }

  function emitStatus(status) {
    if (typeof state.onStatusChange === 'function') {
      try { state.onStatusChange(status); } catch (e) { log('onStatusChange threw: ' + e.message); }
    }
  }

  function defaultWsUrl() {
    // Derive from the page's API base when possible. Dev default mirrors
    // the ZoreeTMS API (ws on the same port as http:3001).
    var base = (global.ZOREE_API_URL || 'http://localhost:3001/api')
      .replace(/\/api\/?$/, '')
      .replace(/^http/, 'ws');
    return base;
  }

  function connect() {
    if (state.stopped) return;
    var url = state.wsUrl || defaultWsUrl();
    log('connecting → ' + url);
    emitStatus('connecting');

    var ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      log('WebSocket ctor failed: ' + e.message);
      scheduleReconnect();
      return;
    }

    state.ws = ws;

    ws.onopen = function () {
      log('open');
      state.backoffMs = MIN_BACKOFF_MS;
      emitStatus('open');
    };

    ws.onmessage = function (ev) {
      var payload;
      try { payload = JSON.parse(ev.data); }
      catch (e) { log('bad JSON frame: ' + e.message); return; }
      if (!payload || !payload.event) return;
      if (typeof state.onEvent === 'function') {
        try { state.onEvent(payload.event, payload.data || {}, payload.ts); }
        catch (e) { log('onEvent threw: ' + e.message); }
      }
    };

    ws.onclose = function (ev) {
      log('close (code=' + ev.code + ')');
      emitStatus('closed');
      state.ws = null;
      scheduleReconnect();
    };

    ws.onerror = function () {
      log('error — will reconnect');
      // onclose will fire next and schedule; avoid double-scheduling here.
      emitStatus('error');
    };
  }

  function scheduleReconnect() {
    if (state.stopped) return;
    if (state.reconnectTimer) return;
    var delay = state.backoffMs;
    log('reconnect in ' + delay + 'ms');
    state.reconnectTimer = global.setTimeout(function () {
      state.reconnectTimer = null;
      connect();
    }, delay);
    state.backoffMs = Math.min(state.backoffMs * 2, MAX_BACKOFF_MS);
  }

  function start(opts) {
    opts = opts || {};
    stop(); // idempotent — safe to call multiple times
    state.stopped        = false;
    state.wsUrl          = opts.wsUrl || null;
    state.onEvent        = opts.onEvent || null;
    state.onStatusChange = opts.onStatusChange || null;
    state.backoffMs      = MIN_BACKOFF_MS;
    connect();
    return { stop: stop };
  }

  function stop() {
    state.stopped = true;
    if (state.reconnectTimer) {
      global.clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    if (state.ws) {
      try { state.ws.close(); } catch (_) { /* ignore */ }
      state.ws = null;
    }
  }

  global.OmsLive = { start: start, stop: stop };
})(typeof window !== 'undefined' ? window : globalThis);
