// Tests for mobile/src/services/offline/conflictResolver.ts.
//
// Pure unit tests — we mock OrdersApi / ShipmentsApi so the decision
// logic can be exercised without a live server. The DB-side tests
// for the queue itself live in writeQueue.test.ts.

import { resolve, replay, versionOf } from '../conflictResolver';
import type { QueueEntry } from '../writeQueue';

jest.mock('../../../lib/api', () => ({
  OrdersApi: {
    full:   jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    remove: jest.fn(),
  },
  ShipmentsApi: {
    get:           jest.fn(),
    update:        jest.fn(),
    updateStatus:  jest.fn(),
    create:        jest.fn(),
    remove:        jest.fn(),
  },
}));

import { OrdersApi, ShipmentsApi } from '../../../lib/api';
const mockOrdersApi    = OrdersApi    as unknown as Record<string, jest.Mock>;
const mockShipmentsApi = ShipmentsApi as unknown as Record<string, jest.Mock>;

beforeEach(() => {
  Object.values(mockOrdersApi).forEach((fn) => fn.mockReset());
  Object.values(mockShipmentsApi).forEach((fn) => fn.mockReset());
});

function entry(over: Partial<QueueEntry> = {}): QueueEntry {
  return {
    id: 1,
    entityType: 'order',
    entityId: 'ORD-1',
    operation: 'status',
    payload: { status: 'Cancelled' },
    baseVersion: '2026-05-10T12:00:00Z',
    enqueuedAt: '2026-05-10T12:00:01Z',
    lastAttemptAt: null,
    attempts: 1,
    status: 'in_flight',
    errorMessage: null,
    ...over,
  };
}

// ── versionOf ───────────────────────────────────────────────────────

describe('versionOf', () => {
  it('reads snake_case updated_at', () => {
    expect(versionOf({ updated_at: '2026-05-10T12:00:00Z' })).toBe('2026-05-10T12:00:00Z');
  });
  it('reads camelCase updatedAt', () => {
    expect(versionOf({ updatedAt: '2026-05-10T12:00:00Z' })).toBe('2026-05-10T12:00:00Z');
  });
  it('returns null for missing version', () => {
    expect(versionOf({ id: 'X' })).toBeNull();
    expect(versionOf(null)).toBeNull();
    expect(versionOf(undefined)).toBeNull();
  });
});

// ── resolve ─────────────────────────────────────────────────────────

describe('resolve — orders', () => {
  it('decision=replay when base_version matches the server row', async () => {
    mockOrdersApi.full.mockResolvedValue({ id: 'ORD-1', updated_at: '2026-05-10T12:00:00Z' });
    const out = await resolve(entry());
    expect(out.decision).toBe('replay');
    expect(out.serverRow).toMatchObject({ id: 'ORD-1' });
  });

  it('decision=conflict when server.updated_at differs from base_version', async () => {
    mockOrdersApi.full.mockResolvedValue({ id: 'ORD-1', updated_at: '2026-05-10T13:00:00Z' });
    const out = await resolve(entry());
    expect(out.decision).toBe('conflict');
    expect(out.reason).toMatch(/updated on the server/i);
  });

  it('decision=conflict when the row is deleted server-side (non-delete op)', async () => {
    mockOrdersApi.full.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
    const out = await resolve(entry({ operation: 'patch' }));
    expect(out.decision).toBe('conflict');
    expect(out.reason).toMatch(/deleted on the server/i);
  });

  it('decision=replay for a delete op even if the row is already gone (idempotent)', async () => {
    mockOrdersApi.full.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));
    const out = await resolve(entry({ operation: 'delete' }));
    expect(out.decision).toBe('replay');
    expect(out.serverRow).toBeNull();
  });

  it('decision=skip on network errors (so the queue stays pending)', async () => {
    mockOrdersApi.full.mockRejectedValue(new Error('Network request failed'));
    const out = await resolve(entry());
    expect(out.decision).toBe('skip');
  });

  it('decision=replay when base_version is null (resolver unconditional)', async () => {
    mockOrdersApi.full.mockResolvedValue({ id: 'ORD-1', updated_at: '2026-05-10T13:00:00Z' });
    const out = await resolve(entry({ baseVersion: null }));
    expect(out.decision).toBe('replay');
  });
});

describe('resolve — shipments', () => {
  it('routes the fetcher to ShipmentsApi.get', async () => {
    mockShipmentsApi.get.mockResolvedValue({ id: 'SHP-1', updated_at: '2026-05-10T12:00:00Z' });
    const out = await resolve(entry({ entityType: 'shipment', entityId: 'SHP-1' }));
    expect(out.decision).toBe('replay');
    expect(mockShipmentsApi.get).toHaveBeenCalledWith('SHP-1');
  });

  it('treats a 404 reason embedded in the error message as not-found', async () => {
    mockShipmentsApi.get.mockRejectedValue(new Error('Server says 404 Not Found'));
    const out = await resolve(entry({ entityType: 'shipment', operation: 'patch' }));
    expect(out.decision).toBe('conflict');
  });
});

// ── replay ──────────────────────────────────────────────────────────

describe('replay — operation dispatch', () => {
  it('order status flips → OrdersApi.update', async () => {
    mockOrdersApi.update.mockResolvedValue({ ok: true });
    await replay(entry());
    expect(mockOrdersApi.update).toHaveBeenCalledWith('ORD-1', { status: 'Cancelled' });
  });

  it('order patch → OrdersApi.update with the payload', async () => {
    mockOrdersApi.update.mockResolvedValue({ ok: true });
    await replay(entry({ operation: 'patch', payload: { customer: 'Acme' } }));
    expect(mockOrdersApi.update).toHaveBeenCalledWith('ORD-1', { customer: 'Acme' });
  });

  it('order delete → OrdersApi.remove', async () => {
    mockOrdersApi.remove.mockResolvedValue({ deleted: true });
    await replay(entry({ operation: 'delete' }));
    expect(mockOrdersApi.remove).toHaveBeenCalledWith('ORD-1');
  });

  it('order create → OrdersApi.create with the payload', async () => {
    mockOrdersApi.create.mockResolvedValue({ id: 'ORD-2' });
    await replay(entry({ operation: 'create', payload: { customer: 'Acme' } }));
    expect(mockOrdersApi.create).toHaveBeenCalledWith({ customer: 'Acme' });
  });

  it('shipment status flips → ShipmentsApi.updateStatus (dedicated /:id/status route)', async () => {
    mockShipmentsApi.updateStatus.mockResolvedValue({ ok: true });
    await replay(entry({
      entityType: 'shipment', entityId: 'SHP-1',
      operation: 'status', payload: { status: 'In Transit' },
    }));
    // QA bug #63 contract: shipment status MUST use the dedicated
    // route, not .update — the dedicated route enforces the state
    // machine.
    expect(mockShipmentsApi.updateStatus).toHaveBeenCalledWith('SHP-1', 'In Transit');
    expect(mockShipmentsApi.update).not.toHaveBeenCalled();
  });

  it('shipment patch → ShipmentsApi.update with the payload', async () => {
    mockShipmentsApi.update.mockResolvedValue({ ok: true });
    await replay(entry({
      entityType: 'shipment', entityId: 'SHP-1',
      operation: 'patch', payload: { carrier: 'AAA' },
    }));
    expect(mockShipmentsApi.update).toHaveBeenCalledWith('SHP-1', { carrier: 'AAA' });
  });

  it('throws on unknown operation', async () => {
    await expect(replay(entry({ operation: 'sneeze' as any })))
      .rejects.toThrow(/unknown operation/i);
  });
});
