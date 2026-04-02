import { configureApi } from '@zoree/shared/src/api';
import { storage } from './storage';
import { API_BASE } from '../config/env';

/**
 * Initialize the shared API client with React Native storage adapter
 * and platform-appropriate base URL.
 * Must be called after storage.init() during app boot.
 */
export function initializeApi(): void {
  configureApi({
    storage,
    apiBase: API_BASE,
  });
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
} from '@zoree/shared/src/api';
