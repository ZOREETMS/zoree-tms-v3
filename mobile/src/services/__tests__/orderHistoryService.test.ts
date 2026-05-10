// Unit tests for mobile/src/services/orderHistoryService.ts.
//
// REQ-02 Phase 1 (mobile parity): the shaping logic must match the
// web client's frontend/src/services/historyService.js so an order
// edited on web shows identically on mobile. We test bucketing,
// FIELD_LABELS, synthetic non-edit changes, and the soft-fail
// contract on network errors.

import {
  shapeOrderHistoryRows,
  loadOrderHistory,
  clearOrderHistory,
} from '../orderHistoryService';

jest.mock('../../lib/api', () => ({
  OrdersApi: {
    history: jest.fn(),
    clearHistory: jest.fn(),
  },
}));

// Pull the mocked OrdersApi back out so we can program responses per test.
import { OrdersApi } from '../../lib/api';
const mockOrdersApi = OrdersApi as unknown as {
  history: jest.Mock;
  clearHistory: jest.Mock;
};

beforeEach(() => {
  mockOrdersApi.history.mockReset();
  mockOrdersApi.clearHistory.mockReset();
});

describe('shapeOrderHistoryRows — empty / null inputs', () => {
  it('returns [] for null', () => {
    expect(shapeOrderHistoryRows(null as any)).toEqual([]);
  });
  it('returns [] for empty array', () => {
    expect(shapeOrderHistoryRows([])).toEqual([]);
  });
});

describe('shapeOrderHistoryRows — bucketing', () => {
  it('groups same-second edits by the same user into one entry', () => {
    const ts = '2026-05-10T12:00:00.000Z';
    const rows = [
      { action: 'edit', field: 'customer',     old_value: 'A',   new_value: 'B',   username: 'u@e.com', created_at: ts },
      { action: 'edit', field: 'service_level', old_value: 'STD', new_value: 'EXP', username: 'u@e.com', created_at: ts },
      { action: 'edit', field: 'po_number',    old_value: '1',   new_value: '2',   username: 'u@e.com', created_at: ts },
    ];
    const out = shapeOrderHistoryRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].changes).toHaveLength(3);
    // FIELD_LABELS coverage — TMS bug #2 regression guard.
    const labels = out[0].changes.map((c) => c.label);
    expect(labels).toContain('Customer');
    expect(labels).toContain('Service Level');
    expect(labels).toContain('PO Number');
  });

  it('separates edits by different users at the same second', () => {
    const ts = '2026-05-10T12:00:00.000Z';
    const rows = [
      { action: 'edit', field: 'customer', old_value: 'A', new_value: 'B', username: 'u1@e.com', created_at: ts },
      { action: 'edit', field: 'origin',   old_value: 'X', new_value: 'Y', username: 'u2@e.com', created_at: ts },
    ];
    const out = shapeOrderHistoryRows(rows);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.user).sort()).toEqual(['u1@e.com', 'u2@e.com']);
  });

  it('separates edits at different seconds even from the same user', () => {
    const rows = [
      { action: 'edit', field: 'customer', old_value: 'A', new_value: 'B', username: 'u@e.com', created_at: '2026-05-10T12:00:00Z' },
      { action: 'edit', field: 'origin',   old_value: 'X', new_value: 'Y', username: 'u@e.com', created_at: '2026-05-10T12:00:01Z' },
    ];
    const out = shapeOrderHistoryRows(rows);
    expect(out).toHaveLength(2);
  });
});

describe('shapeOrderHistoryRows — non-edit synthetic rows', () => {
  it('renders create / delete events', () => {
    const rows = [
      { action: 'create', username: 'p@e.com', created_at: '2026-05-10T10:00:00Z' },
      { action: 'delete', username: 'p@e.com', created_at: '2026-05-10T11:00:00Z' },
    ];
    const out = shapeOrderHistoryRows(rows);
    expect(out[0].changes[0]).toEqual({ label: 'Order', old: '—', new: 'Created' });
    expect(out[1].changes[0]).toEqual({ label: 'Order', old: 'Existed', new: 'Deleted' });
  });

  it('renders plan + unassign with metadata.shipmentId', () => {
    const rows = [
      { action: 'plan',     username: 'p@e.com', created_at: 't1', metadata: { shipmentId: 'SHP-2026-0001' } },
      { action: 'unassign', username: 'p@e.com', created_at: 't2', metadata: { previousShipmentId: 'SHP-2026-0001' } },
    ];
    const out = shapeOrderHistoryRows(rows);
    expect(out[0].changes[0]).toEqual({ label: 'Shipment', old: '—', new: 'SHP-2026-0001' });
    expect(out[1].changes[0]).toEqual({ label: 'Shipment', old: 'SHP-2026-0001', new: '—' });
  });

  it('renders tender events using metadata.carrier', () => {
    const rows = [{
      action: 'tender', username: 'p@e.com', created_at: 't',
      metadata: { carrier: 'AAA Trucking' },
    }];
    expect(shapeOrderHistoryRows(rows)[0].changes[0])
      .toEqual({ label: 'Carrier', old: '—', new: 'AAA Trucking' });
  });

  it('renders status events with old/new values', () => {
    const rows = [{
      action: 'status', field: 'status',
      old_value: 'Unplanned', new_value: 'Planned',
      username: 'p@e.com', created_at: 't',
    }];
    expect(shapeOrderHistoryRows(rows)[0].changes[0])
      .toEqual({ label: 'Status', old: 'Unplanned', new: 'Planned' });
  });
});

describe('shapeOrderHistoryRows — FIELD_LABELS', () => {
  it.each([
    ['service_level',  'Service Level'],
    ['ref_num',        'Reference #'],
    ['po_num',         'PO Number'],
    ['ship_from_name', 'Ship From Name'],
    ['ship_to_name',   'Ship To Name'],
    ['origin_zip',     'Origin ZIP'],
    ['preferred_carrier', 'Preferred Carrier'],
    ['line_count',     'Line Count'],
  ])('maps %s → %s', (field, expected) => {
    const out = shapeOrderHistoryRows([{
      action: 'edit', field, old_value: 'a', new_value: 'b',
      username: 'p@e.com', created_at: '2026-05-10T12:00:00Z',
    }]);
    expect(out[0].changes[0].label).toBe(expected);
  });

  it('renders line_<N> as "Line N"', () => {
    const out = shapeOrderHistoryRows([{
      action: 'edit', field: 'line_3', old_value: '1', new_value: '2',
      username: 'p@e.com', created_at: '2026-05-10T12:00:00Z',
    }]);
    expect(out[0].changes[0].label).toBe('Line 3');
  });

  it('Title-Cases unknown columns', () => {
    const out = shapeOrderHistoryRows([{
      action: 'edit', field: 'some_new_column', old_value: 'a', new_value: 'b',
      username: 'p@e.com', created_at: '2026-05-10T12:00:00Z',
    }]);
    expect(out[0].changes[0].label).toBe('Some New Column');
  });
});

describe('loadOrderHistory', () => {
  it('returns [] for empty orderId', async () => {
    expect(await loadOrderHistory('')).toEqual([]);
    expect(mockOrdersApi.history).not.toHaveBeenCalled();
  });

  it('passes the limit through to the API', async () => {
    mockOrdersApi.history.mockResolvedValue({ rows: [] });
    await loadOrderHistory('ORD-1', 50);
    expect(mockOrdersApi.history).toHaveBeenCalledWith('ORD-1', 50);
  });

  it('shapes the API rows', async () => {
    mockOrdersApi.history.mockResolvedValue({
      rows: [
        { action: 'edit', field: 'customer', old_value: 'A', new_value: 'B',
          username: 'u@e.com', created_at: '2026-05-10T12:00:00Z' },
      ],
    });
    const out = await loadOrderHistory('ORD-1');
    expect(out).toHaveLength(1);
    expect(out[0].changes[0].label).toBe('Customer');
  });

  it('soft-fails to [] when the API throws', async () => {
    mockOrdersApi.history.mockRejectedValue(new Error('network down'));
    expect(await loadOrderHistory('ORD-1')).toEqual([]);
  });

  it('handles a missing rows field on the API response', async () => {
    mockOrdersApi.history.mockResolvedValue({});
    expect(await loadOrderHistory('ORD-1')).toEqual([]);
  });
});

describe('clearOrderHistory', () => {
  it('rejects empty orderId', async () => {
    await expect(clearOrderHistory('')).rejects.toThrow('orderId is required');
  });

  it('returns the server clearedAt', async () => {
    mockOrdersApi.clearHistory.mockResolvedValue({ clearedAt: '2026-05-10T13:00:00Z' });
    expect(await clearOrderHistory('ORD-1')).toBe('2026-05-10T13:00:00Z');
  });

  it('falls back to a fresh timestamp when the server omits clearedAt', async () => {
    mockOrdersApi.clearHistory.mockResolvedValue({});
    const ts = await clearOrderHistory('ORD-1');
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
