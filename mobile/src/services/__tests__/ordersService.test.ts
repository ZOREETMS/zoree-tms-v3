/**
 * Unit tests for mobile/src/services/ordersService.ts
 *
 * Covers the three exposed functions:
 *   - buildOrderCopyPayload  (pure)
 *   - copyOrderLines         (network helper, mocked DbApi/OrdersApi)
 *   - copyOrder              (top-level orchestration)
 *
 * The shared/api module is mocked so tests stay deterministic and
 * never hit the real backend.
 */

import {
  buildOrderCopyPayload,
  copyOrder,
  copyOrderLines,
  nextOrderId,
} from '../ordersService';
import { DbApi, OrdersApi } from '../../shared/api';

jest.mock('../../shared/api', () => ({
  DbApi: { upsert: jest.fn() },
  OrdersApi: { lines: jest.fn(), saveLines: jest.fn() },
}));

describe('nextOrderId', () => {
  it('matches the ORD-YYYY-NNNNNN format', () => {
    expect(nextOrderId()).toMatch(/^ORD-\d{4}-\d{6}$/);
  });
});

describe('buildOrderCopyPayload', () => {
  it('copies core fields and resets status / shipment', () => {
    const src = {
      id: 'ORD-2025-000001',
      customer: 'ACME',
      origin: 'ATLANTA, GA 30350',
      dest: 'DALLAS, TX 75201',
      origin_zip: '30350',
      dest_zip: '75201',
      weight: 1200,
      pieces: 4,
      commodity: 'Widgets',
      ready: '2026-04-26',
      due: '2026-04-30',
      ship_mode: 'TL',
      preferred_carrier: 'AVERITT',
      hazmat: true,
      shipment_id: 'SHP-2026-1234', // must NOT carry over
      status: 'Tendered',           // must reset to Unplanned
      notes: 'fragile',
      po_number: 'PO-9001',
    };

    const out = buildOrderCopyPayload(src, 'ORD-2026-999999');

    expect(out.id).toBe('ORD-2026-999999');
    expect(out.status).toBe('Unplanned');
    expect(out.shipment_id).toBeNull();
    expect(out.customer).toBe('ACME');
    expect(out.origin).toBe('ATLANTA, GA 30350');
    expect(out.dest).toBe('DALLAS, TX 75201');
    expect(out.origin_zip).toBe('30350');
    expect(out.dest_zip).toBe('75201');
    expect(out.weight).toBe(1200);
    expect(out.pieces).toBe(4);
    expect(out.hazmat).toBe(true);
    expect(out.preferred_carrier).toBe('AVERITT');
    expect(out.po_number).toBe('PO-9001');
    expect(out.notes).toBe('fragile');
  });

  it('falls back to camelCase ship_from / po_num aliases (web parity)', () => {
    const src = {
      id: 'X',
      shipFromName: 'WH-A',
      shipToName: 'WH-B',
      po_num: 'PO-7',
    };
    const out = buildOrderCopyPayload(src, 'Y');
    expect(out.ship_from_name).toBe('WH-A');
    expect(out.ship_to_name).toBe('WH-B');
    expect(out.po_number).toBe('PO-7');
  });

  it('coerces nullish optional fields to deterministic defaults', () => {
    const out = buildOrderCopyPayload({ id: 'X' }, 'Y');
    expect(out.customer).toBeNull();
    expect(out.notes).toBeNull();
    expect(out.weight).toBe(0);
    expect(out.pieces).toBe(0);
    expect(out.hazmat).toBe(false);
    expect(out.no_consolidate).toBe(false);
    expect(out.no_contract_rate).toBe(false);
    expect(out.dedicated_equip).toBe(false);
    expect(out.shipment_id).toBeNull();
    expect(out.status).toBe('Unplanned');
  });
});

describe('copyOrderLines', () => {
  it('no-ops when the source has no lines', async () => {
    (OrdersApi.lines as jest.Mock).mockResolvedValue([]);
    await copyOrderLines('A', 'B');
    expect(OrdersApi.saveLines).not.toHaveBeenCalled();
  });

  it('no-ops when the API returns a non-array (defensive)', async () => {
    (OrdersApi.lines as jest.Mock).mockResolvedValue(null);
    await copyOrderLines('A', 'B');
    expect(OrdersApi.saveLines).not.toHaveBeenCalled();
  });

  it('strips line ids and posts a clean payload to the target', async () => {
    (OrdersApi.lines as jest.Mock).mockResolvedValue([
      {
        id: 'A-L1',
        line_num: 1,
        item_id: 'I1',
        description: 'box',
        qty_ordered: 5,
        unit_weight: 10,
        total_weight: 50,
      },
      {
        id: 'A-L2',
        // line_num intentionally missing — should fall back to index+1
        description: 'pallet',
        qty_ordered: 1,
        unit_weight: 200,
        total_weight: 200,
      },
    ]);

    await copyOrderLines('A', 'B');

    expect(OrdersApi.saveLines).toHaveBeenCalledTimes(1);
    expect(OrdersApi.saveLines).toHaveBeenCalledWith('B', [
      {
        line_num: 1,
        item_id: 'I1',
        description: 'box',
        qty_ordered: 5,
        unit_weight: 10,
        total_weight: 50,
      },
      {
        line_num: 2,
        item_id: null,
        description: 'pallet',
        qty_ordered: 1,
        unit_weight: 200,
        total_weight: 200,
      },
    ]);
  });
});

describe('copyOrder', () => {
  it('throws if the source has no id', async () => {
    await expect(copyOrder(undefined as any)).rejects.toThrow(/missing id/);
    await expect(copyOrder({} as any)).rejects.toThrow(/missing id/);
  });

  it('upserts the new order, copies its lines, returns the new row', async () => {
    (DbApi.upsert as jest.Mock).mockResolvedValue(undefined);
    (OrdersApi.lines as jest.Mock).mockResolvedValue([]);

    const src = { id: 'ORD-2025-000001', customer: 'ACME', weight: 500 };
    const out = await copyOrder(src);

    expect(out.id).toMatch(/^ORD-\d{4}-\d{6}$/);
    expect(out.id).not.toBe(src.id);
    expect(out.status).toBe('Unplanned');
    expect(out.customer).toBe('ACME');
    expect(out.weight).toBe(500);

    expect(DbApi.upsert).toHaveBeenCalledWith(
      'orders',
      expect.objectContaining({
        id: out.id,
        customer: 'ACME',
        status: 'Unplanned',
        shipment_id: null,
      }),
    );
    expect(OrdersApi.lines).toHaveBeenCalledWith('ORD-2025-000001');
  });

  it('propagates upsert failures (does not silently swallow)', async () => {
    (DbApi.upsert as jest.Mock).mockRejectedValue(new Error('db down'));
    await expect(copyOrder({ id: 'ORD-1' })).rejects.toThrow('db down');
    // lines must NOT be copied if the parent insert failed
    expect(OrdersApi.lines).not.toHaveBeenCalled();
  });
});
