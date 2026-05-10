// Unit tests for mobile/src/lib/wsClient.ts.
//
// REQ-02 Phase 2 (mobile parity): we don't open a real socket. We
// stub global WebSocket with a controllable fake so each test can
// drive open / message / close / error transitions deterministically.
// The tests assert:
//   • URL derivation from API_BASE
//   • singleton behaviour (multiple connect() → one socket)
//   • listener subscribe / unsubscribe contract
//   • non-JSON frames are dropped
//   • intentional disconnect suppresses reconnect
//   • throwing listeners don't break dispatch to the others

// Mock the env to give a predictable API_BASE before wsClient is
// imported (it reads API_BASE at module load).
jest.mock('../../config/env', () => ({
  API_BASE: 'http://localhost:3001/api',
}));

// Make __DEV__ a no-op truthiness var so the dev-log branches don't
// break test runs in environments that don't define it.
(global as any).__DEV__ = false;

// ── Fake WebSocket constructor ───────────────────────────────────────

interface FakeWs {
  url: string;
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((err: any) => void) | null;
  close: jest.Mock;
  // Test helpers — drive transitions from outside the SUT.
  _open: () => void;
  _msg: (data: string) => void;
  _close: () => void;
  _error: (err: any) => void;
}

let _fakes: FakeWs[] = [];
const FakeWebSocket = jest.fn().mockImplementation(function (this: any, url: string) {
  const ws: FakeWs = {
    url,
    readyState: 0, // CONNECTING
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    close: jest.fn().mockImplementation(function (this: FakeWs) {
      this.readyState = 3; // CLOSED
      if (this.onclose) this.onclose();
    }),
    _open() { this.readyState = 1; if (this.onopen) this.onopen(); },
    _msg(data) { if (this.onmessage) this.onmessage({ data }); },
    _close() { this.readyState = 3; if (this.onclose) this.onclose(); },
    _error(err) { if (this.onerror) this.onerror(err); },
  };
  _fakes.push(ws);
  // Return ws so `new WebSocket(...)` produces our controllable object.
  // jest.fn().mockImplementation is invoked via Reflect.construct.
  return ws;
});

beforeAll(() => {
  (global as any).WebSocket = FakeWebSocket;
});

beforeEach(() => {
  jest.useFakeTimers();
  _fakes = [];
  FakeWebSocket.mockClear();
  // Module reset between tests so the singleton state doesn't leak.
  jest.resetModules();
});

afterEach(() => {
  jest.useRealTimers();
});

function load() {
  // Re-import after resetModules so the fresh module instance picks up
  // the cleared module-level state.
  return require('../wsClient');
}

// ── URL derivation ──────────────────────────────────────────────────

describe('deriveWsUrl', () => {
  it('swaps http:// → ws:// and strips /api', () => {
    const { deriveWsUrl } = load();
    expect(deriveWsUrl('http://localhost:3001/api')).toBe('ws://localhost:3001');
    expect(deriveWsUrl('https://api.zoree.com/api')).toBe('wss://api.zoree.com');
    expect(deriveWsUrl('https://api.zoree.com/api/')).toBe('wss://api.zoree.com');
  });

  it('returns empty string for falsy input', () => {
    const { deriveWsUrl } = load();
    expect(deriveWsUrl('')).toBe('');
    expect(deriveWsUrl(undefined as any)).toBe('');
  });
});

// ── connect ─────────────────────────────────────────────────────────

describe('connect', () => {
  it('opens a single socket on first call', () => {
    const ws = load();
    ws.connect();
    expect(FakeWebSocket).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket).toHaveBeenCalledWith('ws://localhost:3001');
  });

  it('does not open a second socket while connecting', () => {
    const ws = load();
    ws.connect();
    ws.connect();
    expect(FakeWebSocket).toHaveBeenCalledTimes(1);
  });

  it('does not open a second socket while open', () => {
    const ws = load();
    ws.connect();
    _fakes[0]._open();
    ws.connect();
    expect(FakeWebSocket).toHaveBeenCalledTimes(1);
  });
});

// ── onMessage ───────────────────────────────────────────────────────

describe('onMessage', () => {
  it('dispatches parsed JSON to every listener', () => {
    const ws = load();
    ws.connect();
    _fakes[0]._open();
    const a = jest.fn();
    const b = jest.fn();
    ws.onMessage(a);
    ws.onMessage(b);
    _fakes[0]._msg(JSON.stringify({ event: 'shipment_status_updated', data: { id: 'SHP-1' } }));
    expect(a).toHaveBeenCalledWith({ event: 'shipment_status_updated', data: { id: 'SHP-1' } });
    expect(b).toHaveBeenCalledWith({ event: 'shipment_status_updated', data: { id: 'SHP-1' } });
  });

  it('drops non-JSON frames silently', () => {
    const ws = load();
    ws.connect();
    _fakes[0]._open();
    const cb = jest.fn();
    ws.onMessage(cb);
    _fakes[0]._msg('not-json');
    _fakes[0]._msg('');
    expect(cb).not.toHaveBeenCalled();
  });

  it('returns an unsubscribe function that removes the listener', () => {
    const ws = load();
    ws.connect();
    _fakes[0]._open();
    const cb = jest.fn();
    const off = ws.onMessage(cb);
    off();
    _fakes[0]._msg(JSON.stringify({ event: 'tender_accepted' }));
    expect(cb).not.toHaveBeenCalled();
  });

  it('isolates listener exceptions from other listeners', () => {
    const ws = load();
    ws.connect();
    _fakes[0]._open();
    const bad = jest.fn().mockImplementation(() => { throw new Error('boom'); });
    const good = jest.fn();
    ws.onMessage(bad);
    ws.onMessage(good);
    _fakes[0]._msg(JSON.stringify({ event: 'mw_request_processed' }));
    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
  });
});

// ── disconnect / reconnect ───────────────────────────────────────────

describe('disconnect', () => {
  it('closes the socket and suppresses reconnect', () => {
    const ws = load();
    ws.connect();
    _fakes[0]._open();
    ws.disconnect();
    expect(_fakes[0].close).toHaveBeenCalled();
    // Reconnect timer should not be scheduled — advance time and
    // confirm no second socket appears.
    jest.advanceTimersByTime(60_000);
    expect(FakeWebSocket).toHaveBeenCalledTimes(1);
  });

  it('is idempotent', () => {
    const ws = load();
    ws.connect();
    _fakes[0]._open();
    ws.disconnect();
    ws.disconnect(); // second call must not throw
    expect(FakeWebSocket).toHaveBeenCalledTimes(1);
  });
});

describe('auto-reconnect', () => {
  it('schedules a reconnect on unintentional close', () => {
    const ws = load();
    ws.connect();
    _fakes[0]._open();
    _fakes[0]._close(); // server bounced or wifi dropped
    // First reconnect window is the MIN backoff (1000ms in module).
    jest.advanceTimersByTime(1000);
    expect(FakeWebSocket).toHaveBeenCalledTimes(2);
  });

  it('does NOT reconnect after intentional disconnect', () => {
    const ws = load();
    ws.connect();
    _fakes[0]._open();
    ws.disconnect();
    jest.advanceTimersByTime(60_000);
    expect(FakeWebSocket).toHaveBeenCalledTimes(1);
  });

  it('grows backoff on repeated failures', () => {
    const ws = load();
    ws.connect();
    _fakes[0]._open();
    _fakes[0]._close();             // first drop → 1000ms
    jest.advanceTimersByTime(1000); // reconnect attempt #2
    _fakes[1]._close();             // second drop → 2000ms
    jest.advanceTimersByTime(1500); // not enough yet
    expect(FakeWebSocket).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(500);  // total 2000ms reached
    expect(FakeWebSocket).toHaveBeenCalledTimes(3);
  });
});

// ── _internal test helpers ──────────────────────────────────────────

describe('_internal test helpers', () => {
  it('exposes listener count', () => {
    const ws = load();
    ws.onMessage(() => {});
    ws.onMessage(() => {});
    expect(ws._internal.getListenerCount()).toBe(2);
  });

  it('__testReset clears listeners and disconnects', () => {
    const ws = load();
    ws.connect();
    _fakes[0]._open();
    ws.onMessage(() => {});
    ws._internal.__testReset();
    expect(ws._internal.getListenerCount()).toBe(0);
  });

  it('__testDispatch fires listeners without a live socket', () => {
    const ws = load();
    const cb = jest.fn();
    ws.onMessage(cb);
    ws._internal.__testDispatch({ event: 'tender_accepted' });
    expect(cb).toHaveBeenCalledWith({ event: 'tender_accepted' });
  });
});
