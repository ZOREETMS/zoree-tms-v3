// ═══════════════════════════════════════════════════════════════════
// useOrdersPollingFallback — 15s interval refresh as a last-resort
// safety net on the Orders page.
//
// Sits behind the primary SSE stream (subscribeOrderChanges) and the
// Supabase Realtime subscription (useRealtimeOrders). If both of those
// silently die while the tab stays foregrounded, this is what still
// surfaces new OMS-ingested orders within ~15s. Idempotent with the
// other refresh paths — refreshData's underlying fetch is safe to call
// repeatedly; React Query / caller-side coalescing handles dedup.
//
// Only runs while document.visibilityState === "visible" so a pinned
// tab in the background doesn't poll forever.
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useRef } from "react";

const DEFAULT_INTERVAL_MS = 15_000;

/**
 * @param {() => void} refreshData — caller-supplied refetch fn
 * @param {object} [opts]
 * @param {number} [opts.intervalMs=15000] — poll cadence in ms
 */
export function useOrdersPollingFallback(refreshData, opts = {}) {
  const refreshRef = useRef(refreshData);
  useEffect(() => { refreshRef.current = refreshData; }, [refreshData]);

  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;

  useEffect(() => {
    if (typeof document === "undefined") return;

    let timerId = null;

    const start = () => {
      if (timerId != null) return;
      timerId = setInterval(() => {
        try { refreshRef.current?.(); } catch (_) { /* noop */ }
      }, intervalMs);
    };

    const stop = () => {
      if (timerId == null) return;
      clearInterval(timerId);
      timerId = null;
    };

    const syncToVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    syncToVisibility();
    document.addEventListener("visibilitychange", syncToVisibility);

    return () => {
      document.removeEventListener("visibilitychange", syncToVisibility);
      stop();
    };
  }, [intervalMs]);
}
