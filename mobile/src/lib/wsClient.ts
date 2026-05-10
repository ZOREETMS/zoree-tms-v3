// ═══════════════════════════════════════════════════════════════════
// WebSocket Client — REQ-02 Phase 2 (mobile parity, 2026-05-10).
//
// Framework-free port of frontend/src/lib/wsClient.js. Subscribes to
// the TMS Express WebSocket so the mobile app can react to server-
// originated events (tender_accepted, shipment_status_updated,
// shipment_delivered, dock_config_changed, mw_*) — the same events
// the web's omsLive/omsWsClient.js consumes.
//
// Why this exists
// ───────────────
// Until now, mobile only listened to Supabase postgres_changes on the
// `orders` and `shipments` tables. That covers state changes that
// land in those tables but is BLIND to anything OMS-or-middleware-
// driven that doesn't write directly to them (dock-config edits, mw_*
// mappings, transfer-log events). This client closes that gap by
// reading the Express bridge that already broadcasts those events.
//
// Design notes
// ────────────
// • Module-singleton: only one socket connection per process. Multiple
//   callers calling connect() share the same socket.
// • Auto-reconnect with exponential backoff (1s → 30s), matching the
//   web client. Reconnect is suppressed during intentional disconnect
//   so logout / unmount don't ping the server forever.
// • Public surface mirrors the web file so a future shared package
//   could swap the two: connect / disconnect / onMessage.
// • React Native ships the WHATWG WebSocket constructor at the
//   module level — no polyfill needed. We import nothing from the
//   React Navigation / Expo stacks here so the module stays
//   testable in plain Node + jsdom.
// ═══════════════════════════════════════════════════════════════════

import { API_BASE } from '../config/env';

// Express bridge: derive the ws:// URL from API_BASE by swapping the
// protocol and stripping the trailing /api segment. Mirrors the web
// derivation exactly so an env override on either side picks the same
// socket URL.
function deriveWsUrl(apiBase: string): string {
  if (!apiBase) return '';
  return apiBase.replace(/^http/, 'ws').replace(/\/api\/?$/, '');
}

const WS_URL = deriveWsUrl(API_BASE);

const MIN_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30_000;

// Module-singleton state. Tests can call disconnect() in afterEach to
// clear it. Module reload (jest.resetModules) provides full reset.
let _ws: WebSocket | null = null;
let _listeners: Set<(msg: WsMessage) => void> = new Set();
let _reconnectMs = MIN_RECONNECT_MS;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _intentionalClose = false;

export interface WsMessage {
  /** Event name as broadcast by api/server.js (e.g. 'tender_accepted'). */
  event?: string;
  /** Optional event payload. Shape varies per event. */
  data?: unknown;
  /** Optional server timestamp (ISO). */
  ts?: string;
  /** Allow callers to read arbitrary additional fields. */
  [key: string]: unknown;
}

export type WsListener = (msg: WsMessage) => void;

// ── Helpers ─────────────────────────────────────────────────────────

function clearReconnectTimer(): void {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
}

function scheduleReconnect(): void {
  clearReconnectTimer();
  _reconnectTimer = setTimeout(() => {
    _reconnectMs = Math.min(_reconnectMs * 2, MAX_RECONNECT_MS);
    connect();
  }, _reconnectMs);
}

// ── Public surface ──────────────────────────────────────────────────

/**
 * Open the WebSocket connection. Safe to call repeatedly — only one
 * connection is created per process. Re-entering while connecting
 * or open is a no-op.
 */
export function connect(): void {
  if (!WS_URL) {
    // No URL derivable — silently no-op. This matches the web's
    // permissive contract: the rest of the app should keep working
    // (mobile already has Supabase realtime as a parallel channel).
    return;
  }
  if (_ws && (_ws.readyState === 0 /* CONNECTING */ || _ws.readyState === 1 /* OPEN */)) {
    return;
  }
  _intentionalClose = false;

  try {
    _ws = new WebSocket(WS_URL);

    _ws.onopen = () => {
      if (__DEV__) console.log('[ws] connected to', WS_URL);
      _reconnectMs = MIN_RECONNECT_MS;
    };

    _ws.onmessage = (event: { data: any }) => {
      try {
        const parsed = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
        // Defensive copy of the listener set so a callback that
        // unsubscribes itself doesn't perturb the in-flight iteration.
        const snapshot = Array.from(_listeners);
        for (const cb of snapshot) {
          try {
            cb(parsed);
          } catch (err) {
            // A throwing listener must not bring down the socket.
            if (__DEV__) console.warn('[ws] listener threw:', (err as any)?.message);
          }
        }
      } catch {
        // Non-JSON payloads (heartbeats, server pings) are ignored.
      }
    };

    _ws.onclose = () => {
      _ws = null;
      if (!_intentionalClose) {
        if (__DEV__) console.log(`[ws] disconnected; reconnecting in ${_reconnectMs}ms`);
        scheduleReconnect();
      }
    };

    _ws.onerror = () => {
      // onclose follows onerror; reconnect is handled there. We do not
      // log here because RN surfaces errors during routine network
      // hand-offs (5G ↔ Wi-Fi) and the noise drowns out real failures.
    };
  } catch (err) {
    // Constructor failure (e.g. invalid URL): retry on the same
    // backoff schedule.
    if (__DEV__) console.warn('[ws] constructor failed:', (err as any)?.message);
    scheduleReconnect();
  }
}

/**
 * Close the WebSocket connection and stop reconnect attempts. Idempotent.
 *
 * After disconnect(), connect() will reopen a fresh connection. Useful
 * on logout, on unmount of the top-level provider, and from tests.
 */
export function disconnect(): void {
  _intentionalClose = true;
  clearReconnectTimer();
  if (_ws) {
    try { _ws.close(); } catch { /* already closing */ }
  }
  _ws = null;
  _reconnectMs = MIN_RECONNECT_MS;
}

/**
 * Subscribe to incoming messages. Returns an unsubscribe function.
 *
 * Listeners receive the parsed JSON payload as-is. Non-JSON frames are
 * dropped before the listener fires.
 */
export function onMessage(callback: WsListener): () => void {
  _listeners.add(callback);
  return () => {
    _listeners.delete(callback);
  };
}

/**
 * Test-only inspection of internal state. Not part of the documented
 * surface — names start with `_` so reviewers know to leave them
 * alone in production code.
 */
export const _internal = {
  getUrl: (): string => WS_URL,
  getSocketState: (): number | null => (_ws ? _ws.readyState : null),
  getListenerCount: (): number => _listeners.size,
  /**
   * Dispatch a synthetic message to every listener. Tests use this to
   * exercise the dispatch path without needing a live socket.
   */
  __testDispatch: (msg: WsMessage): void => {
    for (const cb of Array.from(_listeners)) {
      try { cb(msg); } catch { /* swallow in tests */ }
    }
  },
  /**
   * Reset module state between tests. Closes any open socket and
   * clears the listener set. Mirrors what disconnect() does plus the
   * listener cleanup that disconnect() deliberately preserves
   * (because the listener set survives reconnects in production).
   */
  __testReset: (): void => {
    disconnect();
    _listeners = new Set();
  },
};

// Exported for testability — derive the same URL the module uses.
export { deriveWsUrl };
