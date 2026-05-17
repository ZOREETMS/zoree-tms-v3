/**
 * Session-expiry contract for the shared API client.
 *
 * Mobile session-expiry fix (2026-05-16): when a request returns 401
 * and the registered `onUnauthorized` refresh hook cannot recover
 * (returns null, throws, or its retry still 401s), api() must:
 *   1. Invoke the registered `onSessionExpired` hook so AuthContext
 *      can clear storage + flip RootNavigator to LoginScreen.
 *   2. Throw an error whose message matches SESSION_EXPIRED_MESSAGE
 *      so screen-level catch blocks (OrderFormScreen, ShipmentDetail,
 *      etc.) can detect the case and suppress the no-longer-relevant
 *      "Could not save" alert.
 *
 * These tests lock both contracts in so a future refactor of the 401
 * branch can't silently regress the user-visible behaviour that the
 * fix was specifically designed to produce.
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import {
  configureApi,
  configureAuthHooks,
  DbApi,
  SESSION_EXPIRED_MESSAGE,
} from '../api';

interface FakeStorage {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
}

// Minimal in-memory storage adapter — matches the shape configureApi
// expects. The token value is what api() passes as the Bearer header;
// we don't assert on it here.
function makeStorage(initial: Record<string, string> = {}): FakeStorage {
  const store: Record<string, string> = { ...initial };
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = v;
    },
    removeItem: (k) => {
      delete store[k];
    },
  };
}

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

describe('shared/api session expiry', () => {
  beforeEach(() => {
    configureApi({
      storage: makeStorage({ zoree_token: 'expired-token' }),
      apiBase: 'http://test.local/api',
    });
    // Reset hooks between tests so a leftover refresh hook from a
    // previous case can't satisfy a 401 it shouldn't.
    configureAuthHooks({ onUnauthorized: null, onSessionExpired: null });
  });

  afterEach(() => {
    if ((global as any).fetch?.mockRestore) (global as any).fetch.mockRestore();
  });

  test('401 with no refresh hook → calls onSessionExpired and throws friendly error', async () => {
    const sessionExpired = jest.fn().mockResolvedValue(undefined);
    configureAuthHooks({ onSessionExpired: sessionExpired });

    (global as any).fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(401, { error: 'Invalid token' }));

    await expect(DbApi.orders()).rejects.toThrow(SESSION_EXPIRED_MESSAGE);
    expect(sessionExpired).toHaveBeenCalledTimes(1);
  });

  test('401 + refresh returns null → still triggers session expiry', async () => {
    const refresh = jest.fn().mockResolvedValue(null);
    const sessionExpired = jest.fn().mockResolvedValue(undefined);
    configureAuthHooks({
      onUnauthorized: refresh,
      onSessionExpired: sessionExpired,
    });

    (global as any).fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(401, { error: 'Invalid token' }));

    await expect(DbApi.orders()).rejects.toThrow(SESSION_EXPIRED_MESSAGE);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(sessionExpired).toHaveBeenCalledTimes(1);
  });

  test('401 → refresh succeeds → request retried with fresh token → no logout', async () => {
    const refresh = jest.fn().mockResolvedValue('fresh-token');
    const sessionExpired = jest.fn().mockResolvedValue(undefined);
    configureAuthHooks({
      onUnauthorized: refresh,
      onSessionExpired: sessionExpired,
    });

    (global as any).fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: 'Invalid token' }))
      .mockResolvedValueOnce(jsonResponse(200, { orders: [{ id: 'O-1' }] }));

    const rows = await DbApi.orders();
    expect(rows).toEqual([{ id: 'O-1' }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    // Successful retry — we must NOT have flipped the session to expired.
    expect(sessionExpired).not.toHaveBeenCalled();
  });

  test('401 → refresh throws → still triggers session expiry (cleanup never crashes call chain)', async () => {
    const refresh = jest.fn().mockRejectedValue(new Error('refresh blew up'));
    const sessionExpired = jest.fn().mockResolvedValue(undefined);
    configureAuthHooks({
      onUnauthorized: refresh,
      onSessionExpired: sessionExpired,
    });

    (global as any).fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(401, { error: 'Invalid token' }));

    await expect(DbApi.orders()).rejects.toThrow(SESSION_EXPIRED_MESSAGE);
    expect(sessionExpired).toHaveBeenCalledTimes(1);
  });

  test('200 OK → onSessionExpired never fires', async () => {
    const sessionExpired = jest.fn();
    configureAuthHooks({ onSessionExpired: sessionExpired });

    (global as any).fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { orders: [] }));

    await DbApi.orders();
    expect(sessionExpired).not.toHaveBeenCalled();
  });
});
