import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Storage adapter that bridges AsyncStorage to the synchronous interface
 * expected by the shared API client.
 *
 * Since AsyncStorage is async, we maintain an in-memory cache that syncs
 * with AsyncStorage on writes. The cache is populated during app boot.
 */
class StorageAdapter {
  private cache: Record<string, string | null> = {};
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    // `zoree_session_expired` is a one-shot flag the AuthContext writes
    // when a 401 forces an auto-logout, so LoginScreen can render a
    // friendly notice on the next paint (mobile session-expiry fix,
    // 2026-05-16). Hydrating it here means the LoginScreen's first
    // render already sees the value without needing an async read.
    const keys = [
      'zoree_token',
      'zoree_refresh_token',
      'zoree_user',
      'zoree_api_base',
      'zoree_session_expired',
    ];
    const pairs = await AsyncStorage.multiGet(keys);
    pairs.forEach(([key, value]) => {
      this.cache[key] = value;
    });
    this.initialized = true;
  }

  getItem(key: string): string | null {
    return this.cache[key] ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.cache[key] = value;
    await AsyncStorage.setItem(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.cache[key] = null;
    await AsyncStorage.removeItem(key);
  }

  clear(): void {
    this.cache = {};
    this.initialized = false;
  }
}

export const storage = new StorageAdapter();
