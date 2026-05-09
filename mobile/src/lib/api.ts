import { configureApi } from '../shared/api';
import { storage } from './storage';
import { API_BASE } from '../config/env';
import { configureSupabase } from './supabaseClient';

/**
 * Initialize the shared API client with React Native storage adapter
 * and platform-appropriate base URL.
 * Must be called after storage.init() during app boot.
 *
 * Reads the API base from storage (set via Settings screen) first,
 * falling back to the compiled-in default in env.ts.
 *
 * QA bug #60: also configures the Supabase client used for Realtime
 * subscriptions (see useRealtimeData). Falls back to compiled-in
 * defaults; an explicit URL/key can be plugged in here once a Settings
 * screen exposes them.
 */
export function initializeApi(): void {
  const stored = storage.getItem('zoree_api_base');
  const apiBase = stored && stored.trim() ? stored : API_BASE;
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
  configureAuthHooks,
} from '../shared/api';
