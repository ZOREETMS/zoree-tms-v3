// ═══════════════════════════════════════════════════════════════════
// orderDetailDataService — fresh-fetch helper for OrderDetailScreen.
//
// Why this exists
// ───────────────
// OrderDetailScreen previously read the order header from
// DataContext.data.orders via Array.find(). That works fine when
// DataContext is fresh, but it has two failure modes that the user
// hit on 2026-05-16:
//
//   1. Supabase Realtime is silently disabled in builds that ship
//      without EXPO_PUBLIC_SUPABASE_ANON_KEY (see lib/supabaseClient).
//      In that case useRealtimeData's onChange (refreshData) never
//      fires from a web-side edit, so data.orders stays stale until
//      the user pull-to-refreshes or backgrounds + foregrounds the
//      app. The screen has no way to know this; it just renders the
//      stale row.
//
//   2. Even with Realtime working, until migration 045 bumped
//      orders.updated_at on every UPDATE, the postgres_changes UPDATE
//      did fire but the row that came back over /api/orders looked
//      identical by signature (updated_at unchanged) so any caller
//      keying on `updated_at > since` could miss it. Defence in depth:
//      always fetch the canonical row on screen open, regardless of
//      what the cache thinks.
//
// This service does one thing: hits GET /api/orders/:id/full and
// returns the raw row stripped of the `lines` array (the per-line
// table is loaded separately by OrdersApi.lines so we don't double-
// render it). The endpoint already exists (api/server.js around
// L1645) and uses the user's token for RLS, identical to the listing
// query — so the row that comes back is the same row data.orders
// would have, just guaranteed fresh.
//
// Design notes (CLAUDE_RULES alignment)
// ─────────────────────────────────────
// • Pure service module under src/services/ (§1, §2).
// • No React, no RN — unit-testable from the node jest environment.
// • Falls back to null on any network error; callers are expected to
//   keep showing the cached row in the meantime (§3 — degrade
//   gracefully, never blank the screen because of a transient blip).
// • Keeps the existing OrdersApi.lines / loadOrderHistory paths
//   untouched so the surface area of this change stays small.
// ═══════════════════════════════════════════════════════════════════

// @ts-expect-error — shared/api.js is JS, no .d.ts.
import { OrdersApi } from '../lib/api';

/**
 * Header-only shape returned by fetchOrderHeaderFresh. Mirrors what the
 * existing data.orders rows look like for OrderDetailScreen — same keys
 * the screen's view model already accepts in both casings. We do NOT
 * narrow this to a strict type because:
 *
 *   • The raw /api/orders/:id/full response is unwrapped (snake_case
 *     column names), while data.orders comes from dbToOrderApi
 *     (camelCase). buildOrderDetailViewModel handles both via its
 *     readString / readDate / readStringOrNull fall-through chains.
 *   • Narrowing here would force a duplicate type definition that
 *     would drift away from the API response, which is exactly the
 *     drift class CLAUDE_RULES §10 (single source of truth) warns
 *     about.
 *
 * The opaque `Record<string, any>` is intentional — view-model
 * construction is the layer that promises field stability.
 */
export type FreshOrderHeader = Record<string, any>;

/**
 * Fetch the canonical order row from the server. Returns null on any
 * error (network, 404, RLS deny) so the caller can fall back to the
 * cached row without throwing. The `lines` array is stripped because
 * OrderDetailScreen loads lines separately via OrdersApi.lines and
 * we don't want two competing sources for the per-line table.
 *
 * Safe to call repeatedly — there is no client-side caching layer
 * here; the request goes through the standard api() wrapper which
 * has its own 15s timeout + one-shot retry (api.js documentation).
 */
export async function fetchOrderHeaderFresh(
  orderId: string,
): Promise<FreshOrderHeader | null> {
  if (!orderId || orderId === 'new') return null;
  try {
    const row = await OrdersApi.full(orderId);
    if (!row || typeof row !== 'object') return null;
    // Strip the lines collection — the screen owns its own
    // per-line fetch and we don't want to double-render.
    // Spread first so we don't mutate the API response object.
    const { lines: _lines, ...header } = row as Record<string, any>;
    return header;
  } catch {
    // Network blip, 404 (deleted between list and detail), or RLS
    // deny. The screen will keep showing the cached row from
    // data.orders rather than blank — that matches the existing
    // "Order not found" guard which only triggers when BOTH the
    // cache miss AND the fresh fetch fail.
    return null;
  }
}
