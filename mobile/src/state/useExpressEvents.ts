// ═══════════════════════════════════════════════════════════════════
// useExpressEvents — REQ-02 Phase 2 (mobile parity, 2026-05-10).
//
// Subscribes the caller to the TMS Express WebSocket bridge and fires
// a debounced refresh callback when an event the mobile UI cares about
// arrives. Designed to be a sibling to useRealtimeData:
//
//   useRealtimeData({ enabled, onChange })   ← Supabase postgres_changes
//   useExpressEvents({ enabled, onChange })  ← Express WS broadcasts
//
// Together they cover the two channels the web app reacts to. Without
// this hook, mobile is blind to OMS/middleware-driven events that don't
// land in the orders/shipments tables (dock-config edits, mw_*
// mappings, transfer-log events). Risk #2 in the 2026-05-09 audit.
// ═══════════════════════════════════════════════════════════════════

import { useEffect } from 'react';
import { AppState } from 'react-native';
import {
  connect as wsConnect,
  disconnect as wsDisconnect,
  onMessage as wsOnMessage,
  type WsMessage,
} from '../lib/wsClient';

export interface UseExpressEventsArgs {
  /** Only subscribe when this is true. */
  enabled: boolean;
  /** Called (debounced) when an interesting event arrives. */
  onChange: () => void | Promise<void>;
  /** Override the debounce window — only useful in tests. */
  debounceMs?: number;
  /**
   * Optional event allow-list. Defaults to the events the web's
   * omsLive/omsWsClient.js refreshes on (plus the dock + mw events
   * the web reacts to via separate listeners). Pass an empty array to
   * react to every event (rare — usually a sign you should add to the
   * default list instead).
   */
  events?: readonly string[];
}

const DEFAULT_DEBOUNCE_MS = 250;

/**
 * Default event allow-list. Every entry is a server-broadcast event
 * the mobile UI must refresh on.
 *
 * Two naming conventions are intentional and reflect two different
 * emission paths on the server side:
 *
 *   1. Dot-named events come from the in-process EventBus
 *      (api/services/eventBus.js) and are bridged to wsBroadcast in
 *      api/server.js. These fire on direct DB writes the API performs
 *      itself (ship-confirm, POD, manual timeline events, the
 *      shipment-status PATCH that mobile and web both call).
 *
 *        shipment.updated  — any shipment row change worth a refresh
 *                            (status flip, dock edit, OMS POD landing)
 *        shipment.deleted  — shipment row removed; orders cascade to
 *                            Unplanned, so the list view must refresh
 *
 *      Without these in the allow-list, mobile is blind to shipment
 *      writes that don't *also* land in supabase_realtime (e.g. cold
 *      paths during a Realtime outage, or RLS-filtered cases). Adding
 *      them is belt-and-suspenders alongside useRealtimeData.ts.
 *
 *   2. Snake_cased events come from the OMS middleware via POST
 *      /api/notify (api/server.js wsBroadcast passthrough). These
 *      cover OMS/middleware-driven signals that don't always touch
 *      the orders/shipments tables.
 *
 *        tender_accepted          — carrier accepted a tendered shipment
 *        shipment_status_updated  — non-terminal status flip via OMS
 *        shipment_delivered       — terminal status reached via OMS
 *        dock_config_changed      — dock door / loading-window edits
 *        planning_parameters_changed — admin tweaked planning knobs
 *        rate_updated / rate_deleted — pricing changes affecting quotes
 *        lane_preference_changed  — preferred-carrier list edits
 *        mw_request_processed     — middleware finished an OMS bridge job
 *
 * Add to this list (and ensure the server emits the matching event)
 * before relying on a new event. Quietly receiving an unknown event
 * is fine — we just ignore it.
 */
export const DEFAULT_EVENT_ALLOW_LIST: readonly string[] = Object.freeze([
  // In-process bus → wsBroadcast bridge (see api/server.js ~4169-4180).
  'shipment.updated',
  'shipment.deleted',
  // OMS middleware → POST /api/notify → wsBroadcast.
  'tender_accepted',
  'shipment_status_updated',
  'shipment_delivered',
  'dock_config_changed',
  'planning_parameters_changed',
  'rate_updated',
  'rate_deleted',
  'lane_preference_changed',
  'mw_request_processed',
]);

/**
 * Subscribe to the Express WS bridge while `enabled` is true. The
 * subscription is torn down on unmount or when `enabled` flips false.
 *
 * The callback is debounced — multiple events arriving in close
 * succession (a planning batch fires several at once) collapse into
 * a single refreshData call.
 *
 * On AppState 'active' transition we trigger the same callback so a
 * phone returning from background catches up even if the socket was
 * suspended.
 */
export function useExpressEvents({
  enabled,
  onChange,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  events = DEFAULT_EVENT_ALLOW_LIST,
}: UseExpressEventsArgs): void {
  useEffect(() => {
    if (!enabled) return;

    const allowSet = events.length === 0 ? null : new Set(events);

    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          const result = onChange();
          if (result && typeof (result as any).catch === 'function') {
            (result as any).catch(() => {
              // Swallow refresh errors — a flaky network must not
              // wedge the WS listener.
            });
          }
        } catch {
          // Same — never let a refresh error tear down the listener.
        }
        timer = null;
      }, debounceMs);
    };

    const handleMessage = (msg: WsMessage) => {
      const ev = typeof msg?.event === 'string' ? msg.event : '';
      if (!ev) return;
      if (allowSet && !allowSet.has(ev)) return;
      fire();
    };

    // Open (or join) the singleton socket and register our listener.
    wsConnect();
    const unsubscribe = wsOnMessage(handleMessage);

    // App-foreground refresh: when the user returns from background
    // (phone asleep, app switched away) the socket may have been
    // suspended. Force a refresh so the screen they're on doesn't
    // render stale data while waiting for the next event.
    const appStateSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') fire();
    });

    return () => {
      if (timer) clearTimeout(timer);
      appStateSub.remove();
      unsubscribe();
      // We do NOT call wsDisconnect() here — other consumers (future
      // hooks for other slices) may share the singleton socket. The
      // socket is torn down when the *whole* app unmounts the provider,
      // by the explicit logout path below.
    };
  }, [enabled, onChange, debounceMs, events]);

  // Disconnect the socket entirely when the parent provider goes
  // unauthenticated. The hook is called once at the provider level so
  // this fires on logout, app close, etc.
  useEffect(() => {
    if (!enabled) {
      wsDisconnect();
    }
  }, [enabled]);
}
