import { configureApi } from '../shared/api';
import { storage } from './storage';
import { API_BASE } from '../config/env';

/**
 * Initialize the shared API client with React Native storage adapter
 * and platform-appropriate base URL.
 * Must be called after storage.init() during app boot.
 *
 * Reads the API base from storage (set via Settings screen) first,
 * falling back to the compiled-in default in env.ts.
 */
export function initializeApi(): void {
  const stored = storage.getItem('zoree_api_base');
  const apiBase = stored && stored.trim() ? stored : API_BASE;
  configureApi({
    storage,
    apiBase,
  });
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
  TenderApi,
  OmsApi,
  InvoicesApi,
  MileageApi,
  BulkPlanApi,
} from '../shared/api';
