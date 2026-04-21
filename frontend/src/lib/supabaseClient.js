// ═══════════════════════════════════════════════════════════════════
// Single Supabase browser client for the React TMS frontend.
// Used ONLY for Realtime subscriptions today — all REST still goes
// through the Express API at /api/* so service credentials stay
// server-side. This client needs only the anon key.
//
// Config (set in .env / your CI secret store):
//   VITE_SUPABASE_URL      — e.g. https://ljbeihotrmyqthxptcgp.supabase.co
//   VITE_SUPABASE_ANON_KEY — anon key from Supabase → Settings → API
//
// A window.ZOREE_SUPABASE_URL / ZOREE_SUPABASE_ANON_KEY fallback is
// provided so the values can also be injected by a runtime config
// script tag in index.html if you prefer that over Vite env.
// ═══════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";

function readConfig() {
  const url =
    import.meta.env.VITE_SUPABASE_URL ||
    (typeof window !== "undefined" && window.ZOREE_SUPABASE_URL) ||
    "";
  const anonKey =
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    (typeof window !== "undefined" && window.ZOREE_SUPABASE_ANON_KEY) ||
    "";
  return { url, anonKey };
}

const { url, anonKey } = readConfig();

let supabaseClient = null;
if (url && anonKey) {
  supabaseClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });
} else if (typeof window !== "undefined") {
  // Soft-fail: missing config should not crash the app. Features that
  // rely on the client (Realtime) will gracefully no-op.
  // eslint-disable-next-line no-console
  console.warn(
    "[supabaseClient] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — Realtime disabled.",
  );
}

export const supabase = supabaseClient;

export function isSupabaseReady() {
  return supabaseClient != null;
}
