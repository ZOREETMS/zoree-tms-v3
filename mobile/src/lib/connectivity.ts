// ═══════════════════════════════════════════════════════════════════
// Connectivity — REQ-OFFLINE Phase 5 (mobile, 2026-05-10).
//
// Single source of truth for the device's online/offline state.
// Wraps @react-native-community/netinfo with a module-singleton store
// and a small subscriber registry so the rest of the app does not
// each separately wire a NetInfo listener (which would multiply the
// platform overhead and produce inconsistent reads across screens).
//
// Public surface
// ──────────────
//   • init()           — start listening. Idempotent. Call once from App.
//   • destroy()        — stop listening. Tests + clean teardown only.
//   • getStatus()      — current cached status (sync, fast).
//   • isOnline()       — convenience boolean.
//   • subscribe(cb)    — fires on every status transition. Returns unsub.
//   • setForTest(s)    — test-only override of the cached status. NEVER
//                        used in production code paths.
//
// Status semantics
// ────────────────
// We collapse NetInfo's rich state machine into a 3-value enum the
// rest of the app cares about:
//
//   'online'   → isConnected && isInternetReachable !== false
//   'offline'  → isConnected === false OR isInternetReachable === false
//   'unknown'  → boot state before NetInfo has answered once
//
// `isInternetReachable` can lag the underlying socket (NetInfo probes
// it via a captive-portal check). We deliberately treat `false` as
// offline so a captive-portal hotel wifi doesn't fool the app into
// thinking it can reach api.zoree.com. `null` (still probing) is
// treated as online — better to optimistically try the request than
// to wedge the UI for the duration of the probe.
// ═══════════════════════════════════════════════════════════════════

import NetInfo, { type NetInfoSubscription, type NetInfoState } from '@react-native-community/netinfo';

// ── Public types ────────────────────────────────────────────────────

export type ConnectivityStatus = 'online' | 'offline' | 'unknown';

export interface ConnectivitySnapshot {
  status: ConnectivityStatus;
  /** True iff status === 'online'. Cheap to read in render. */
  isOnline: boolean;
  /**
   * Raw NetInfo state — exposed so debug screens can show the WiFi/
   * cellular details. Most callers should not need this.
   */
  raw?: NetInfoState | null;
}

export type ConnectivityListener = (snapshot: ConnectivitySnapshot) => void;

// ── Module-singleton state ──────────────────────────────────────────

let _status: ConnectivityStatus = 'unknown';
let _raw: NetInfoState | null = null;
let _unsubNetInfo: NetInfoSubscription | null = null;
let _listeners: Set<ConnectivityListener> = new Set();

function emit() {
  const snap: ConnectivitySnapshot = {
    status: _status,
    isOnline: _status === 'online',
    raw: _raw,
  };
  for (const cb of Array.from(_listeners)) {
    try { cb(snap); } catch (err) {
      if (__DEV__) console.warn('[connectivity] listener threw:', (err as any)?.message);
    }
  }
}

function deriveStatus(state: NetInfoState | null): ConnectivityStatus {
  if (!state) return 'unknown';
  if (state.isConnected === false) return 'offline';
  if (state.isInternetReachable === false) return 'offline';
  return 'online';
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Start the NetInfo subscription. Idempotent — subsequent calls are
 * no-ops. Call once from App boot.
 */
export function init(): void {
  if (_unsubNetInfo) return;

  // Pull the current state once so callers don't see 'unknown' for
  // longer than absolutely necessary. NetInfo.fetch() is async; we
  // attach the addEventListener first so any state change between
  // fetch() resolving and our listener attaching is not lost.
  _unsubNetInfo = NetInfo.addEventListener((state) => {
    _raw = state;
    const next = deriveStatus(state);
    if (next !== _status) {
      _status = next;
      emit();
    }
  });

  NetInfo.fetch()
    .then((state) => {
      _raw = state;
      const next = deriveStatus(state);
      if (next !== _status) {
        _status = next;
        emit();
      } else if (_status === 'unknown') {
        // Force an emit on first fetch even if status stays 'unknown'
        // so subscribers wired up between init() and the first
        // NetInfo event get a snapshot.
        emit();
      }
    })
    .catch(() => {
      // NetInfo.fetch can reject on first call before the native
      // module fully initializes (rare, but seen on Android cold
      // start). Treat as 'unknown' — the addEventListener path will
      // correct it as soon as the OS has data.
    });
}

/**
 * Stop the NetInfo subscription and clear listeners. Use from tests
 * or from a teardown path that wants a clean reset. Production code
 * should not need this.
 */
export function destroy(): void {
  if (_unsubNetInfo) {
    _unsubNetInfo();
    _unsubNetInfo = null;
  }
  _listeners = new Set();
  _status = 'unknown';
  _raw = null;
}

/** Current cached snapshot. Synchronous, safe to call from render. */
export function getStatus(): ConnectivitySnapshot {
  return {
    status: _status,
    isOnline: _status === 'online',
    raw: _raw,
  };
}

/** Convenience accessor. */
export function isOnline(): boolean {
  return _status === 'online';
}

/**
 * Subscribe to status changes. The callback fires on every transition
 * (not on every NetInfo event). Returns an unsubscribe function.
 */
export function subscribe(cb: ConnectivityListener): () => void {
  _listeners.add(cb);
  // Fire once with the current snapshot so the consumer doesn't have
  // to call getStatus() separately right after subscribing.
  try { cb(getStatus()); } catch (_) { /* listener error, ignore */ }
  return () => { _listeners.delete(cb); };
}

/**
 * Test-only — override the cached status and fire listeners. Lets
 * unit tests drive offline/online transitions without poking NetInfo
 * internals. Production code MUST NOT call this.
 */
export function setForTest(status: ConnectivityStatus): void {
  if (_status === status) return;
  _status = status;
  emit();
}

// ── Test-only internal handles ──────────────────────────────────────

export const _internal = {
  /** Current listener count. Useful for leak-detection in tests. */
  getListenerCount: (): number => _listeners.size,
  /** Read the derived-status function for unit testing. */
  deriveStatus,
};
