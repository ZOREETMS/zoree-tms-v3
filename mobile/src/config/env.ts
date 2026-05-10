import { Platform } from 'react-native';

/**
 * API base URL configuration.
 * Android emulator uses 10.0.2.2 to reach host machine's localhost.
 * iOS simulator can use localhost directly.
 */
/**
 * IMPORTANT: Replace this IP with your computer's local network IP.
 * Find it by running: ipconfig (Windows) or ifconfig (Mac/Linux)
 * Your iPhone must be on the same Wi-Fi network as your computer.
 */
const LOCAL_IP = '100.110.157.135';

const DEV_API_BASE = Platform.select({
  android: `http://10.0.2.2:3001/api`,
  ios: `http://${LOCAL_IP}:3001/api`,
  default: `http://${LOCAL_IP}:3001/api`,
});

const PROD_API_BASE = 'https://messaging-eternal-slope-indexed.trycloudflare.com/api';

export const API_BASE = __DEV__ ? DEV_API_BASE : PROD_API_BASE;

export const APP_VERSION = '1.0.0';
export const APP_NAME = 'Zoree TMS';

/**
 * Supabase project — used ONLY for the Realtime websocket and the
 * client-side token refresh flow (see lib/supabaseClient.ts and
 * state/AuthContext.tsx). All data writes still go through the Express
 * API per CLAUDE_RULES (UI never hits Supabase REST directly).
 *
 * QA bug #60: until this conduit was added, the anon key was a
 * compile-time '' literal in two places, so configureSupabase silently
 * disabled itself and Realtime never connected — the user had to
 * pull-to-refresh to see status updates. Single source of truth here
 * keeps the URL + key in sync between supabaseClient.ts and
 * AuthContext.tsx, and lets the build wire them via EXPO_PUBLIC_* env
 * vars (Expo inlines those at bundle time) without committing a key
 * to the repo.
 *
 * Build wiring (.env / EAS secrets):
 *   EXPO_PUBLIC_SUPABASE_URL       — defaults to the project URL below
 *                                    (the one api/server.js targets).
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY  — REQUIRED for Realtime to connect.
 *                                    Without it Realtime is silently
 *                                    disabled and the app falls back
 *                                    to manual refresh (logged once).
 */
const DEFAULT_SUPABASE_URL = 'https://ljbeihotrmyqthxptcgp.supabase.co';

export const SUPABASE_URL =
  (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim() || DEFAULT_SUPABASE_URL;

export const SUPABASE_ANON_KEY =
  (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();
