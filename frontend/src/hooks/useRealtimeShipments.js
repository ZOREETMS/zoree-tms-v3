// ═══════════════════════════════════════════════════════════════════
// useRealtimeShipments — Supabase Realtime subscription on
// public.shipments. Sibling to useRealtimeOrders (which covers the
// orders table) so each page can subscribe to the table it actually
// renders.
//
// QA bugs #129 / #130: status changes made on mobile (Tender Accept,
// In-Transit, Delivered) propagate through to the orders table via
// the server's syncLinkedOrdersForShipmentStatus cascade, so users on
// the OrdersPage already see them via useRealtimeOrders. But users
// sitting on ShipmentsPage saw the shipment row as stale until they
// manually refreshed because the web had no shipments subscription.
// This hook closes that gap with the same debounce + auto-reconnect
// behaviour as useRealtimeOrders.
//
// Same dependencies + env requirements as useRealtimeOrders:
//   • @supabase/supabase-js installed
//   • VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
//   • public.shipments in the supabase_realtime publication (verified
//     2026-04-20 alongside orders; no migration needed)
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useRef } from "react";
import { supabase, isSupabaseReady } from "../lib/supabaseClient";

const DEBOUNCE_MS = 250;

/**
 * @param {() => void} refreshData  — caller-supplied refetch fn
 * @param {object} [opts]
 * @param {(evt: 'INSERT'|'UPDATE'|'DELETE', row: object) => void} [opts.onEvent]
 *        Optional raw event hook (e.g. for a "live updates" indicator).
 */
export function useRealtimeShipments(refreshData, opts = {}) {
  const refreshRef = useRef(refreshData);
  const optsRef = useRef(opts);
  useEffect(() => { refreshRef.current = refreshData; }, [refreshData]);
  useEffect(() => { optsRef.current = opts; }, [opts]);

  const debounceRef = useRef(null);

  useEffect(() => {
    if (!isSupabaseReady()) return; // env not configured — noop

    const triggerRefresh = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        try { refreshRef.current?.(); } catch (_) { /* noop */ }
      }, DEBOUNCE_MS);
    };

    // Channel name distinct from the orders subscription so a single
    // page that mounts both hooks doesn't collide. Supabase channel
    // names are per-client, not global, so multiple devices sharing
    // names is fine.
    const channel = supabase
      .channel("rt:shipments")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shipments" },
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
