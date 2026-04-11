/**
 * WebSocket Client — real-time connection to TMS API.
 * Auto-reconnects on disconnect with exponential backoff.
 * Service layer — no React dependencies.
 */

// Derive WS URL from API base — same host/port, ws:// protocol
const API_BASE = import.meta.env.VITE_API_BASE || window.ZOREE_API_URL || "http://localhost:3001/api";
const WS_URL = API_BASE.replace(/^http/, "ws").replace(/\/api\/?$/, "");
const MIN_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30000;

let _ws = null;
let _listeners = new Set();
let _reconnectMs = MIN_RECONNECT_MS;
let _reconnectTimer = null;
let _intentionalClose = false;

/**
 * Connect to the TMS WebSocket server.
 * Safe to call multiple times — only creates one connection.
 */
export function connect() {
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;
  _intentionalClose = false;

  try {
    _ws = new WebSocket(WS_URL);

    _ws.onopen = () => {
      console.log('[WS] Connected to', WS_URL);
      _reconnectMs = MIN_RECONNECT_MS;
    };

    _ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        _listeners.forEach((cb) => cb(msg));
      } catch {
        // ignore non-JSON messages
      }
    };

    _ws.onclose = () => {
      _ws = null;
      if (!_intentionalClose) {
        console.log(`[WS] Disconnected. Reconnecting in ${_reconnectMs}ms...`);
        _reconnectTimer = setTimeout(() => {
          _reconnectMs = Math.min(_reconnectMs * 2, MAX_RECONNECT_MS);
          connect();
        }, _reconnectMs);
      }
    };

    _ws.onerror = () => {
      // onclose will fire after onerror — reconnect handled there
    };
  } catch {
    // WebSocket constructor failed — schedule reconnect
    _reconnectTimer = setTimeout(connect, _reconnectMs);
  }
}

/**
 * Disconnect from the WebSocket server.
 */
export function disconnect() {
  _intentionalClose = true;
  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  if (_ws) _ws.close();
  _ws = null;
}

/**
 * Register a callback for incoming messages.
 * @param {function} callback - receives parsed message { event, data, ts }
 * @returns {function} unsubscribe function
 */
export function onMessage(callback) {
  _listeners.add(callback);
  return () => _listeners.delete(callback);
}
