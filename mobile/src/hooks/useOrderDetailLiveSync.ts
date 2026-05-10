// ════════════════════════════════════════════════════════════════════
// useOrderDetailLiveSync — REQ-XXX (web↔mobile order sync, 2026-05-10).
//
// Why this exists
// ───────────────
// The mobile OrderDetailScreen renders three slices of data:
//
//   1. The order header (status, customer, weight, pieces, …) — sourced
//      from data.orders inside DataContext. Already live via
//      useRealtimeData (Supabase postgres_changes on `orders`).
//
//   2. The per-line table — fetched on mount via OrdersApi.lines(id)
//      into local screen state. Previously its useEffect dep was just
//      [orderId], so an order edited on web (which always PATCHes the
//      parent `orders` row to refresh line_count/weight/pieces — see
//      api/server.js POST /api/orders/:id/lines) would refresh the
//      header but leave the per-line list stale until pull-to-refresh.
//
//   3. The change-history list — same pattern, dep [orderId, historyTick]
//      where historyTick was only bumped by *local* mutations.
//
// This hook closes both gaps without re-implementing the realtime
// transport. It watches the live data.orders array for changes to the
// order in question and exposes a monotonic `tick` that callers add
// to their refetch effect's dep array. When the tick increments, the
// effect re-runs and refetches lines/history from the server.
//
// Design notes (CLAUDE_RULES alignment)
// ─────────────────────────────────────
// • Single-purpose hook in src/hooks/ (§1, §2).
// • Pure derivation lives in ./orderDetailSyncSignature so it can be
//   unit-tested without React or RN (§6). The mobile jest config is
//   testEnvironment: 'node' — pulling RN into a hook test would blow
//   up at parse time on RN's flow-typed index.
// • Sources data.orders from DataContext (the existing server-state
//   slice). No new realtime channel, no new API call (§3, §4).
// • AppState 'active' transition also bumps the tick — mirrors what
//   useRealtimeData already does for the global refresh, so a phone
//   returning from sleep catches up without pull-to-refresh.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useData } from '../state/DataContext';
import { getOrderSyncSignature } from './orderDetailSyncSignature';

// Re-export the pure helper so callers that already import from this
// module (and tests living next to the hook in the future) don't have
// to chase a second path.
export { getOrderSyncSignature } from './orderDetailSyncSignature';

/**
 * Subscribe the OrderDetailScreen to live changes for one order.
 *
 * Returns a number that increments whenever:
 *   • The signature of `data.orders[orderId]` changes (i.e. realtime
 *     pushed an update and DataContext.refreshData() rehydrated the
 *     orders array), OR
 *   • The app returns from background to the foreground (AppState
 *     'active') — covers the case where the realtime socket was
 *     suspended while the phone was asleep and the user is now
 *     looking at a detail screen that may be stale.
 *
 * Use as a useEffect dependency to refetch lines / history / any
 * per-detail data the screen owns:
 *
 *   const syncTick = useOrderDetailLiveSync(orderId);
 *   useEffect(() => { fetchLines(orderId).then(setLines); },
 *            [orderId, syncTick]);
 */
export function useOrderDetailLiveSync(orderId: string | null | undefined): number {
  const { data } = useData();
  const [tick, setTick] = useState(0);

  // Track the last-seen signature in a ref so we don't fire on every
  // unrelated DataContext re-render — only when the *signature* (the
  // server's view of this order) actually changes.
  const lastSig = useRef<string>('');

  useEffect(() => {
    const sig = getOrderSyncSignature(data.orders, orderId);
    if (sig !== lastSig.current) {
      const wasFirstObservation = lastSig.current === '';
      lastSig.current = sig;
      // Only bump the tick after we've seen at least one signature for
      // this order — the first observation on mount is what the parent
      // fetch effect already covers from its [orderId] dep, so a tick
      // there would cause a redundant double-fetch on every screen open.
      if (sig !== '' && !wasFirstObservation) {
        setTick((t) => t + 1);
      }
    }
  }, [data.orders, orderId]);

  // Reset signature tracking when the user navigates between orders so
  // the next mount doesn't carry stale comparison state.
  useEffect(() => {
    lastSig.current = '';
  }, [orderId]);

  // App-foreground catch-up. Mirrors the same defence-in-depth used by
  // useRealtimeData — if the WS was suspended in background, force a
  // refetch now that the screen is visible again.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') setTick((t) => t + 1);
    });
    return () => sub.remove();
  }, []);

  return tick;
}
