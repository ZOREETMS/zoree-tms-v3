// ═══════════════════════════════════════════════════════════════════
// "Sign in with Microsoft" — Supabase Auth's Azure (Entra ID) provider.
//
// startMicrosoftSignIn() sends the browser to Microsoft's own sign-in
// page (the customer's tenant, MFA and access rules apply there). On the
// way back Supabase puts the session in the URL fragment;
// takeMicrosoftRedirect() reads it once and strips it from the address
// bar. The API then turns that session into TMS roles
// (POST /api/auth/microsoft/session).
// ═══════════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";

let client = null;
function oauthClient() {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  client = createClient(url, anonKey, {
    auth: {
      flowType: "implicit",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "zoree-ms-signin",
    },
  });
  return client;
}

export async function startMicrosoftSignIn() {
  const c = oauthClient();
  if (!c) throw new Error("Microsoft sign-in is not configured in this build.");
  const { error } = await c.auth.signInWithOAuth({
    provider: "azure",
    options: { scopes: "email profile", redirectTo: `${window.location.origin}/` },
  });
  if (error) throw error;
}

/** Session or error from a Microsoft redirect, read once; null when this load isn't one. */
export function takeMicrosoftRedirect() {
  if (typeof window === "undefined") return null;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const accessToken = hash.get("access_token");
  const error = hash.get("error_description") || hash.get("error") || query.get("error_description") || query.get("error");
  if (!accessToken && !error) return null;
  const clean = window.location.pathname;
  window.history.replaceState(null, "", clean);
  if (error) return { error: error.replace(/\+/g, " ") };
  return { accessToken, refreshToken: hash.get("refresh_token") || "" };
}

/** End the Microsoft session too, so the next sign-in asks again (single sign-out). */
export function microsoftSignOutUrl(tenantId) {
  const t = tenantId ? encodeURIComponent(tenantId) : "common";
  const back = encodeURIComponent(`${window.location.origin}/`);
  return `https://login.microsoftonline.com/${t}/oauth2/v2.0/logout?post_logout_redirect_uri=${back}`;
}
