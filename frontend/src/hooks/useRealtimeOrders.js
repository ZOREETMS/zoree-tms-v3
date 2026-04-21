// ═══════════════════════════════════════════════════════════════════
// useRealtimeOrders — Supabase Realtime subscription on public.orders.
//
// Works as a reliability backup to the SSE stream on /api/events/orders.
// Either signal triggers the same `refreshData()` callback, debounced
// so a burst of inserts doesn't cause a dozen refetches. Safe to mount
// alongside the existing SSE subscription — duplicate refetches are
// swallowed by the debounce.
//
// Requires:
//   • @supabase/supabase-js installed (package.json)
//   • VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY env vars
//   • public.orders already in the `supabase_realtime` publication
//     (verified 2026-04-20; no migration needed)
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useRef } from "react";
import { supabase, isSupabaseReady } from "../lib/supabaseClient";

const DEBOUNCE_MS = 250;

/**
 * @param {() => void} refreshData  — caller-supplied refetch fn
 * @param {object} [opts]
 * @param {(evt: 'INSERT'|'UPDATE'|'DELETE', row: object) => void} [opts.onEvent]
 *        Optional raw event hook (e.g. for toast notifications).
 */
export function useRealtimeOrders(refreshData, opts = {}) {
  const refreshRef = useRef(refreshData);
  const optsRef = useRef(opts);
  useEffect(() => { refreshRef.current = refreshData; }, [refreshData]);
  useEffect(() => { optsRef.current = opts; }, [opts]);

  const debounceRef = useRef(null);

  useEffect(() => {
    if (!isSupabaseReady()) return;   // env not configured — noop

    const triggerRefresh = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        try { refreshRef.current?.(); } catch (_) { /* noop */ }
      }, DEBOUNCE_MS);
    };

    const channel = supabase
      .channel("rt:orders")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        (payload) => {
          try {
            optsRef.current?.onEvent?.(
              payload.eventType,
              payload.new || payload.old,
            );
          } catch (_) { /* don't let handler throw break the stream */ }
          triggerRefresh();
        },
      )
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      try { supabase.removeChannel(channel); } catch (_) { /* noop */ }
    };
  }, []);
}
