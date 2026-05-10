// Tests for mobile/src/lib/connectivity.ts.
//
// We mock @react-native-community/netinfo so the SUT exercises real
// state transitions without needing the native module to be linked.
// The mock exposes a `__fireState()` test helper that pushes a
// fabricated NetInfoState through every registered subscriber.

jest.mock('@react-native-community/netinfo', () => {
  let listeners: Array<(s: any) => void> = [];
  return {
    __esModule: true,
    default: {
      addEventListener: (cb: (s: any) => void) => {
        listeners.push(cb);
        return () => { listeners = listeners.filter((l) => l !== cb); };
      },
      fetch: jest.fn().mockResolvedValue({
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
      }),
    },
    __fireState: (s: any) => {
      for (const l of listeners) l(s);
    },
    __reset: () => { listeners = []; },
  };
});

import NetInfo from '@react-native-community/netinfo';
import * as connectivity from '../connectivity';

const NetInfoTestHandles = require('@react-native-community/netinfo') as {
  __fireState: (s: any) => void;
  __reset: () => void;
};

beforeEach(() => {
  // Module-level state reset between tests.
  connectivity.destroy();
  NetInfoTestHandles.__reset();
  (NetInfo.fetch as jest.Mock).mockClear();
  (NetInfo.fetch as jest.Mock).mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
    type: 'wifi',
  });
});

afterAll(() => {
  connectivity.destroy();
});

// ── deriveStatus pure tests ─────────────────────────────────────────

describe('deriveStatus', () => {
  const derive = connectivity._internal.deriveStatus;

  it('null state → unknown', () => {
    expect(derive(null)).toBe('unknown');
  });

  it('isConnected:false → offline (regardless of probe)', () => {
    expect(derive({ isConnected: false, isInternetReachable: true } as any)).toBe('offline');
  });

  it('isInternetReachable:false → offline (captive portal)', () => {
    expect(derive({ isConnected: true, isInternetReachable: false } as any)).toBe('offline');
  });

  it('isInternetReachable:null → online (probe in progress, optimistic)', () => {
    expect(derive({ isConnected: true, isInternetReachable: null } as any)).toBe('online');
  });

  it('isInternetReachable:true → online', () => {
    expect(derive({ isConnected: true, isInternetReachable: true } as any)).toBe('online');
  });
});

// ── init / subscribe / transitions ──────────────────────────────────

describe('init + subscribe', () => {
  it('emits an initial snapshot to a subscriber registered before init resolves', async () => {
    const cb = jest.fn();
    connectivity.subscribe(cb);
    // Subscriber receives the current cached snapshot synchronously on
    // subscribe (status='unknown' at boot).
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ status: 'unknown' }));
  });

  it('moves to online when NetInfo.fetch resolves online', async () => {
    connectivity.init();
    await Promise.resolve(); // let .fetch().then(…) run
    await Promise.resolve();
    expect(connectivity.isOnline()).toBe(true);
  });

  it('fires listeners on offline transition', async () => {
    connectivity.init();
    await Promise.resolve();
    await Promise.resolve();
    const cb = jest.fn();
    connectivity.subscribe(cb);
    cb.mockClear();
    NetInfoTestHandles.__fireState({ isConnected: false, isInternetReachable: false });
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({
      status: 'offline',
      isOnline: false,
    }));
  });

  it('does not fire listeners when status does not change', async () => {
    connectivity.init();
    await Promise.resolve();
    await Promise.resolve();
    const cb = jest.fn();
    connectivity.subscribe(cb);
    cb.mockClear();
    // Push the same online state again — no transition.
    NetInfoTestHandles.__fireState({ isConnected: true, isInternetReachable: true });
    expect(cb).not.toHaveBeenCalled();
  });

  it('subscribe returns a working unsubscribe', async () => {
    const cb = jest.fn();
    const off = connectivity.subscribe(cb);
    cb.mockClear();
    off();
    NetInfoTestHandles.__fireState({ isConnected: false, isInternetReachable: false });
    expect(cb).not.toHaveBeenCalled();
  });

  it('init is idempotent — calling it twice does not double-subscribe to NetInfo', () => {
    connectivity.init();
    const beforeListeners = connectivity._internal.getListenerCount();
    connectivity.init();
    expect(connectivity._internal.getListenerCount()).toBe(beforeListeners);
  });
});

// ── setForTest ──────────────────────────────────────────────────────

describe('setForTest', () => {
  it('drives transitions without NetInfo', () => {
    const cb = jest.fn();
    connectivity.subscribe(cb);
    cb.mockClear();
    connectivity.setForTest('offline');
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ status: 'offline' }));
    connectivity.setForTest('online');
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ status: 'online' }));
  });

  it('does not re-fire when the target status matches current', () => {
    connectivity.setForTest('offline');
    const cb = jest.fn();
    connectivity.subscribe(cb);
    cb.mockClear();
    connectivity.setForTest('offline'); // no-op
    expect(cb).not.toHaveBeenCalled();
  });
});

// ── destroy ─────────────────────────────────────────────────────────

describe('destroy', () => {
  it('clears all listeners and resets status to unknown', () => {
    connectivity.subscribe(() => {});
    connectivity.subscribe(() => {});
    expect(connectivity._internal.getListenerCount()).toBe(2);
    connectivity.destroy();
    expect(connectivity._internal.getListenerCount()).toBe(0);
    expect(connectivity.getStatus().status).toBe('unknown');
  });
});
