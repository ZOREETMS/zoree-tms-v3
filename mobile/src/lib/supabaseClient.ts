/**
 * Singleton Supabase client used ONLY for Realtime subscriptions on
 * mobile. All write operations continue to flow through the Express
 * API (CLAUDE_RULES — UI never hits Supabase REST directly).
 *
 * Why a separate client from the Express API path:
 *   - Realtime is a websocket channel, not a REST call.
 *   - The TMS web app already does the same: frontend/src/hooks/
 *     useRealtimeOrders.js subscribes via the supabase-js client while
 *     all writes still go through the API. Mobile mirrors that pattern
 *     so an order patched on web shows up on mobile within ~250ms
 *     (debounced refresh).
 *
 * Anon key is fine here because:
 *   - We do not call .from(table).insert/update/delete via this client.
 *   - The existing RLS policies on orders/shipments already allow
 *     anon SELECT (they were already load-bearing for the OMS HTML
 *     apps, per the project memory). Realtime piggy-backs on the
 *     same SELECT policy.
 *
 * QA bug #60 fix: subscribing to postgres_changes on orders +
 * shipments lets the DataContext refresh without a manual pull-down.
 * Same hook also resolves bug #63 (Pickup -> In Transit skip) once
 * the device receives the intermediate Confirmed/In Transit row.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Defaults used when no per-tenant override is provided. Sourced from
// the same project as api/server.js. Keep in sync if Supabase project
// rotates — there's no .env file on mobile builds.
const DEFAULT_SUPABASE_URL = 'https://ljbeihotrmyqthxptcgp.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = '';

let _client: SupabaseClient | null = null;

/**
 * Configure the singleton. Call from app boot once we know the
 * tenant's Supabase project (or fall back to defaults).
 */
export function configureSupabase({
  url,
  anonKey,
}: {
  url?: string;
  anonKey?: string;
}): void {
  const finalUrl = url || DEFAULT_SUPABASE_URL;
  const finalKey = anonKey || DEFAULT_SUPABASE_ANON_KEY;
  if (!finalUrl || !finalKey) {
    // Without an anon key, Realtime would silently fail — log loudly
    // so dev catches a misconfigured build before QA does.
    // eslint-disable-next-line no-console
    console.warn(
      '[supabaseClient] Missing Supabase URL or anon key — Realtime disabled. Set SUPABASE_ANON_KEY in mobile build config.',
    );
    _client = null;
    return;
  }
  _client = createClient(finalUrl, finalKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });
}

/**
 * Returns the configured client, or null when Realtime isn't
 * available (no anon key / dev setup). Callers must handle null and
 * fall back to manual refresh.
 */
export function getSupabaseClient(): SupabaseClient | null {
  return _client;
}
