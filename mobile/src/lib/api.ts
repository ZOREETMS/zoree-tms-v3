import { configureApi } from '../shared/api';
import { storage } from './storage';
import { API_BASE } from '../config/env';
import { configureSupabase } from './supabaseClient';

/**
 * Initialize the shared API client with React Native storage adapter
 * and platform-appropriate base URL.
 * Must be called after storage.init() during app boot.
 *
 * Priority order:
 *   - DEV builds (`__DEV__ === true`) ALWAYS use the compiled-in env.ts
 *     value and overwrite any persisted override. Developers iterating
 *     on the laptop's LAN IP (e.g. when they move desks or change
 *     Wi-Fi) want env.ts to be the single source of truth; a stored
 *     override from a previous run silently shadowing env.ts is the
 *     cause of "cannot reach server" errors that look like a network
 *     problem but are really a stale cached endpoint (2026-05-16
 *     debug session).
 *   - PROD builds read the stored override first (set via Settings /
 *     Login → Advanced) so a deployed app can be repointed at a new
 *     tunnel URL without a rebuild, falling back to the compiled-in
 *     default.
 *
 * QA bug #60: also configures the Supabase client used for Realtime
 * subscriptions (see useRealtimeData). Falls back to compiled-in
 * defaults; an explicit URL/key can be plugged in here once a Settings
 * screen exposes them.
 */
export function initializeApi(): void {
  let apiBase: string;
  if (__DEV__) {
    // Force env.ts in dev. Wipe any stored override so the Settings /
    // Login Advanced field re-populates from env.ts the next time it
    // mounts (otherwise the UI keeps showing the stale URL).
    apiBase = API_BASE;
    const stored = storage.getItem('zoree_api_base');
    if (stored && stored !== API_BASE) {
      // Fire-and-forget; AsyncStorage write doesn't need to block boot.
      storage.removeItem('zoree_api_base').catch(() => {});
    }
  } else {
    const stored = storage.getItem('zoree_api_base');
    apiBase = stored && stored.trim() ? stored : API_BASE;
  }
  configureApi({
    storage,
    apiBase,
  });
  configureSupabase({});
}

/**
 * Update the API base URL at runtime and persist it to storage.
 * Called from the Settings screen when the user saves a new endpoint.
 */
export async function updateApiBase(newApiBase: string): Promise<void> {
  const trimmed = (newApiBase || '').trim();
  if (!trimmed) return;
  await storage.setItem('zoree_api_base', trimmed);
  configureApi({ apiBase: trimmed });
}

// Re-export all API modules from shared for convenience
export {
  AuthApi,
  DbApi,
  OrdersApi,
  ShipmentsApi,
  TenderApi,
  OmsApi,
  InvoicesApi,
  MileageApi,
  NotifyApi,
  BulkPlanApi,
  // QA P208 (2026-05-11): admin user-management surface for the
  // mobile UserManagement / UserRoles screens.
  UsersApi,
  configureAuthHooks,
} from '../shared/api';
