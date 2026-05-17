// ═══════════════════════════════════════════════════════════════════
// useFreshOrderHeader — keeps OrderDetailScreen's header in sync with
// the server regardless of whether Supabase Realtime is firing.
//
// Why this exists
// ───────────────
// The screen used to read its order strictly from
// DataContext.data.orders. When a web user edited ready/due dates on
// an order and the mobile device's Realtime channel was suspended,
// disconnected, or never configured (no EXPO_PUBLIC_SUPABASE_ANON_KEY
// in the build), refreshData was never called and the header stayed
// stale forever — even though History reloaded fresh on screen open.
// That mismatch is the bug @sidtkonathala reported on 2026-05-16.
//
// This hook fixes that without re-routing the entire DataContext: it
// fetches the canonical order row from /api/orders/:id/full whenever
// the screen mounts, the order id changes, or the live-sync tick from
// useOrderDetailLiveSync increments (which it now does correctly
// after migration 045 added the orders.updated_at trigger). The
// fresh row wins over the cached one; if the fetch fails or is
// in-flight, we hand back the cached row so the screen never blanks.
//
// Design notes (CLAUDE_RULES alignment)
// ─────────────────────────────────────
// • Single-purpose hook in src/hooks/ (§1, §2).
// • All fetching delegated to services/orderDetailDataService — the
//   hook only owns React state + effect orchestration (§3, §6).
// • Does not touch DataContext; consumers can pass whatever cached
//   row they already have. Keeps the seam testable in isolation.
// • Late-response guard via a monotonic request id (mirrors the
//   pattern OrderDetailScreen already uses for the lines fetch —
//   QA 241, 2026-05-12) so a slow earlier fetch can never overwrite
//   the result of a newer one.
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import {
  fetchOrderHeaderFresh,
  type FreshOrderHeader,
} from '../services/orderDetailDataService';

export interface UseFreshOrderHeaderResult {
  /**
   * The freshest order row we have. Priority:
   *   1. The most recent successful fresh-fetch.
   *   2. Otherwise the `cached` row the caller passed in.
   *   3. Null if neither exists.
   * View-model construction (buildOrderDetailViewModel) accepts both
   * camelCase (cached from dbToOrderApi) and snake_case (fresh from
   * /api/orders/:id/full) so the screen renders identically either way.
   */
  order: FreshOrderHeader | null;
  /**
   * True while a fresh fetch is in flight AND we have no prior fresh
   * result. Goes false the moment we have either a fresh row or an
   * error — the cached row already covers the rendering need.
   */
  loading: boolean;
}

/**
 * @param orderId        Route param id (or 'new' / null when none).
 * @param cachedOrder    The row from DataContext.data.orders, if any.
 * @param refreshTick    Increment to force a re-fetch. OrderDetailScreen
 *                       wires this to useOrderDetailLiveSync's tick so a
 *                       realtime UPDATE (which now reliably bumps
 *                       updated_at after migration 045) re-pulls the
 *                       canonical row.
 */
export function useFreshOrderHeader(
  orderId: string | null | undefined,
  cachedOrder: FreshOrderHeader | null | undefined,
  refreshTick: number,
): UseFreshOrderHeaderResult {
  const [fresh, setFresh] = useState<FreshOrderHeader | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const reqIdRef = useRef(0);

  useEffect(() => {
    // Clear stale fresh state when the user navigates between orders
    // so the new screen doesn't briefly render the previous order's
    // header while the next fetch is in flight.
    setFresh(null);

    if (!orderId || orderId === 'new') {
      setLoading(false);
      return;
    }

    let alive = true;
    const myReq = ++reqIdRef.current;
    setLoading(true);

    fetchOrderHeaderFresh(orderId)
      .then((row) => {
        // Late-response guard: if a newer fetch was issued before this
        // one resolved, ignore the older result. Same pattern as the
        // lines fetch in OrderDetailScreen (lineFetchRef).
        if (!alive || reqIdRef.current !== myReq) return;
        setFresh(row);
      })
      .finally(() => {
        if (!alive || reqIdRef.current !== myReq) return;
        setLoading(false);
      });

    return () => {
      alive = false;
    };
    // refreshTick is in the deps on purpose — see jsdoc above.
  }, [orderId, refreshTick]);

  return {
    order: fresh ?? cachedOrder ?? null,
    // Only surface "loading" when we have nothing to show. The cached
    // row already covers the rendering need while a fresh fetch is
    // racing, so the screen shouldn't flash a spinner over real data.
    loading: loading && !cachedOrder && !fresh,
  };
}
