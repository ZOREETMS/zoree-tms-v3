/**
 * Unit tests for mobile/src/services/ordersService.ts
 *
 * Covers the exposed functions:
 *   - nextOrderId            (pure)
 *   - buildOrderCopyPayload  (pure)
 *   - buildOrderSavePayload  (pure)
 *   - validateOrderPayload   (pure)
 *   - copyOrderLines         (network helper, mocked OrdersApi)
 *   - copyOrder              (orchestration via OrdersApi.create)
 *   - saveOrder              (orchestration via OrdersApi.create/update)
 *
 * The shared/api module is mocked so tests stay deterministic and
 * never hit the real backend.
 */

import {
  buildOrderCopyPayload,
  buildOrderSavePayload,
  copyOrder,
  copyOrderLines,
  nextOrderId,
  saveOrder,
  validateOrderPayload,
} from '../ordersService';
import { OrdersApi } from '../../shared/api';

jest.mock('../../shared/api', () => ({
  OrdersApi: {
    lines: jest.fn(),
    saveLines: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
}));

beforeEach(() => {
  (OrdersApi.lines as jest.Mock).mockReset();
  (OrdersApi.saveLines as jest.Mock).mockReset();
  (OrdersApi.create as jest.Mock).mockReset();
  (OrdersApi.update as jest.Mock).mockReset();
});

describe('nextOrderId', () => {
  it('matches the ORD-YYYY-NNNNNN format', () => {
    expect(nextOrderId()).toMatch(/^ORD-\d{4}-\d{6}$/);
  });
});

describe('buildOrderCopyPayload', () => {
  it('preserves a camelCase source coming from GET /api/orders', () => {
    // dbToOrderApi shape — this is exactly what mobile DataContext
    // sees from the API list endpoint.
    const src = {
      id: 'ORD-2025-000001',
      customer: 'ACME',
      origin: 'ATLANTA, GA 30350',
      destination: 'DALLAS, TX 75201',
      originZip: '30350',
      destZip: '75201',
      weight: 1200,
      pieces: 4,
      commodity: 'Widgets',
      readyDate: '2026-04-26',
      dueDate: '2026-04-30',
      shipMode: 'TL',
      preferredCarrier: 'AVERITT',
      hazmat: true,
      shipmentId: 'SHP-2026-1234', // must NOT carry over
      status: 'Tendered',           // must reset to Unplanned
      notes: 'fragile',
      poNum: 'PO-9001',
    };

    const out = buildOrderCopyPayload(src, 'ORD-2026-999999');

    expect(out.id).toBe('ORD-2026-999999');
    expect(out.status).toBe('Unplanned');
    expect(out.shipmentId).toBeNull();
    expect(out.customer).toBe('ACME');
    expect(out.origin).toBe('ATLANTA, GA 30350');
    expect(out.destination).toBe('DALLAS, TX 75201');
    expect(out.originZip).toBe('30350');
    expect(out.destZip).toBe('75201');
    expect(out.weight).toBe(1200);
    expect(out.pieces).toBe(4);
    expect(out.hazmat).toBe(true);
    expect(out.preferredCarrier).toBe('AVERITT');
    expect(out.poNum).toBe('PO-9001');
    expect(out.notes).toBe('fragile');
    expect(out.shipMode).toBe('TL');
    expect(out.readyDate).toBe('2026-04-26');
    expect(out.dueDate).toBe('2026-04-30');
  });

  it('also accepts a snake_case source (raw DB row / web parity)', () => {
    const src = {
      id: 'ORD-2025-000002',
      customer: 'ACME',
      origin: 'X',
      dest: 'Y',
      origin_zip: '11111',
      dest_zip: '22222',
      ship_from_name: 'WH-A',
      ship_to_name: 'WH-B',
      ship_mode: 'LTL',
      preferred_carrier: 'XPO',
      no_consolidate: true,
      ready: '2026-04-26',
      due: '2026-04-30',
      po_num: 'PO-7',
      service_level: 'Expedited',
    };
    const out = buildOrderCopyPayload(src, 'NEW');
    expect(out.destination).toBe('Y');
    expect(out.originZip).toBe('11111');
    expect(out.destZip).toBe('22222');
    expect(out.shipFromName).toBe('WH-A');
    expect(out.shipToName).toBe('WH-B');
    expect(out.shipMode).toBe('LTL');
    expect(out.preferredCarrier).toBe('XPO');
    expect(out.noConsolidate).toBe(true);
    expect(out.readyDate).toBe('2026-04-26');
    expect(out.dueDate).toBe('2026-04-30');
    expect(out.poNum).toBe('PO-7');
    expect(out.serviceLevel).toBe('Expedited');
  });

  it('coerces nullish optional fields to deterministic defaults', () => {
    const out = buildOrderCopyPayload({ id: 'X' }, 'Y');
    expect(out.customer).toBeNull();
    expect(out.notes).toBeNull();
    expect(out.weight).toBe(0);
    expect(out.pieces).toBe(0);
    expect(out.hazmat).toBe(false);
    expect(out.noConsolidate).toBe(false);
    expect(out.noContractRate).toBe(false);
    expect(out.dedicatedEquip).toBe(false);
    expect(out.shipmentId).toBeNull();
    expect(out.status).toBe('Unplanned');
  });

  it('survives a null source rather than throwing on .x access', () => {
    const out = buildOrderCopyPayload(null, 'Y');
    expect(out.id).toBe('Y');
    expect(out.status).toBe('Unplanned');
  });
});

describe('buildOrderSavePayload', () => {
  it('coerces form strings to wire types', () => {
    const out = buildOrderSavePayload({
      id: 'ORD-1',
      customer: '  ACME  ',
      origin: 'A',
      destination: 'B',
      weight: '1,200',
      pieces: '4',
      hazmat: true,
      notes: '',
    });
    expect(out.customer).toBe('ACME');
    expect(out.weight).toBe(1200);
    expect(out.pieces).toBe(4);
    expect(out.hazmat).toBe(true);
    expect(out.notes).toBeNull(); // empty string → null so DB stores cleanly
    expect(out.commodity).toBe('General'); // default
  });

  it('falls back from destination to dest', () => {
    const out = buildOrderSavePayload({ dest: 'DALLAS' });
    expect(out.destination).toBe('DALLAS');
  });
});

describe('validateOrderPayload', () => {
  it('flags missing required fields', () => {
    const errs = validateOrderPayload({ weight: 0 });
    expect(errs).toEqual(expect.arrayContaining([
      'Customer is required',
      'Origin is required',
      'Destination is required',
      'Weight must be greater than 0',
    ]));
  });

  it('passes a complete payload', () => {
    const errs = validateOrderPayload({
      customer: 'ACME', origin: 'A', destination: 'B', weight: 100,
    });
    expect(errs).toEqual([]);
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

  it('routes through OrdersApi.create (NOT raw DbApi.upsert) and copies lines', async () => {
    (OrdersApi.create as jest.Mock).mockResolvedValue({ id: 'GENERATED', customer: 'ACME' });
    (OrdersApi.lines as jest.Mock).mockResolvedValue([]);

    // Source mirrors what mobile DataContext sees — camelCase from
    // dbToOrderApi. This is the case that previously 400'd because
    // the legacy upsert path read source.dest (undefined) and sent
    // dest:null to a NOT-NULL column.
    const src = {
      id: 'ORD-2025-000001',
      customer: 'ACME',
      origin: 'X',
      destination: 'Y',
      weight: 500,
    };
    const out = await copyOrder(src);

    expect(OrdersApi.create).toHaveBeenCalledTimes(1);
    const sentPayload = (OrdersApi.create as jest.Mock).mock.calls[0][0];
    expect(sentPayload.id).toMatch(/^ORD-\d{4}-\d{6}$/);
    expect(sentPayload.id).not.toBe(src.id);
    expect(sentPayload.status).toBe('Unplanned');
    expect(sentPayload.shipmentId).toBeNull();
    expect(sentPayload.customer).toBe('ACME');
    // Critical: destination must be carried over even though the
    // source uses camelCase. This is the regression test for the
    // "Upsert failed (400)" QA failure.
    expect(sentPayload.destination).toBe('Y');

    expect(OrdersApi.lines).toHaveBeenCalledWith('ORD-2025-000001');
    expect(out.customer).toBe('ACME');
  });

  it('propagates create failures (does not silently swallow)', async () => {
    (OrdersApi.create as jest.Mock).mockRejectedValue(new Error('db down'));
    await expect(copyOrder({ id: 'ORD-1' })).rejects.toThrow('db down');
    // lines must NOT be copied if the parent insert failed
    expect(OrdersApi.lines).not.toHaveBeenCalled();
  });
});

describe('saveOrder', () => {
  it('rejects an invalid form before hitting the API', async () => {
    await expect(
      saveOrder({ customer: '', origin: '', destination: '', weight: '' }),
    ).rejects.toThrow(/Customer is required/);
    expect(OrdersApi.create).not.toHaveBeenCalled();
    expect(OrdersApi.update).not.toHaveBeenCalled();
  });

  it('calls OrdersApi.create when no orderId is supplied', async () => {
    (OrdersApi.create as jest.Mock).mockResolvedValue({ id: 'NEW' });
    const out = await saveOrder({
      customer: 'ACME', origin: 'A', destination: 'B', weight: '500', pieces: '2',
    });
    expect(OrdersApi.create).toHaveBeenCalledTimes(1);
    expect(OrdersApi.update).not.toHaveBeenCalled();
    expect(out.id).toBe('NEW');
  });

  it('calls OrdersApi.update when orderId is supplied', async () => {
    (OrdersApi.update as jest.Mock).mockResolvedValue({ id: 'ORD-1', customer: 'ACME-2' });
    const out = await saveOrder(
      { customer: 'ACME-2', origin: 'A', destination: 'B', weight: '500' },
      'ORD-1',
    );
    expect(OrdersApi.update).toHaveBeenCalledTimes(1);
    expect((OrdersApi.update as jest.Mock).mock.calls[0][0]).toBe('ORD-1');
    expect(OrdersApi.create).not.toHaveBeenCalled();
    expect(out.customer).toBe('ACME-2');
  });
});
