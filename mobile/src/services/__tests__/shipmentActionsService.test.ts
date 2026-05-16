/**
 * Tests for mobile/src/services/shipmentActionsService.ts —
 * focused on the acceptTender path because that's where the
 * "OMS shows Awaiting TMS Plan after mobile accept" bug lived.
 *
 * The other action helpers (tenderShipment, withdrawTender, change-
 * carrier, invoice) keep their existing behavior; this file does not
 * re-cover them.
 */

import { acceptTender } from '../shipmentActionsService';
import { ShipmentsApi } from '../../shared/api';
import { OmsApi, NotifyApi } from '../../lib/api';
import { updateOrderStatus } from '../offline/offlineOrderActions';

jest.mock('../../shared/api', () => ({
  ShipmentsApi: {
    update: jest.fn(),
  },
  // shipmentActionsService also imports BulkPlanApi for the change-
  // carrier flow. Stub it so jest doesn't complain about the import.
  BulkPlanApi: {
    rate: jest.fn(),
  },
}));

jest.mock('../../lib/api', () => ({
  OmsApi:    { push: jest.fn() },
  NotifyApi: { broadcast: jest.fn() },
}));

jest.mock('../offline/offlineOrderActions', () => ({
  updateOrderStatus: jest.fn(),
}));

const shipment = {
  id: 'SHP-1',
  carrier: 'JB Hunt',
  mode: 'TL',
  service_level: 'STD',
  pickup_date: '2026-04-30',
  delivery_date: '2026-05-02',
  dock_door: 'Door 1',
  loading_start: '2026-04-30 06:00',
  loading_end: '2026-04-30 08:00',
  bol_number: 'BOL-9',
  seal_number: 'SEAL-1',
  origin: 'Dallas',
  dest: 'Atlanta',
  weight: 1000,
  pieces: 4,
  commodity: 'PALLETS',
  cost: 2500,
};

const orders = [
  { id: 'ORD-1', shipment_id: 'SHP-1', status: 'Tendered' },
  { id: 'ORD-2', shipment_id: 'SHP-1', status: 'Tendered' },
  { id: 'ORD-3', shipment_id: 'SHP-OTHER', status: 'Tendered' },  // unrelated
];

describe('acceptTender', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ShipmentsApi.update as jest.Mock).mockResolvedValue({ ok: true });
    (OmsApi.push as jest.Mock).mockResolvedValue({ ok: true });
    (NotifyApi.broadcast as jest.Mock).mockResolvedValue({ ok: true });
    (updateOrderStatus as jest.Mock).mockResolvedValue({ status: 'applied' });
  });

  it('returns an early error when shipment id is missing', async () => {
    const out = await acceptTender({ shipment: {} });
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/not loaded/);
    expect(ShipmentsApi.update).not.toHaveBeenCalled();
    expect(OmsApi.push).not.toHaveBeenCalled();
  });

  it('flips the shipment status to "Tender Accepted" via the audited route', async () => {
    await acceptTender({ shipment, shipments: [shipment], orders });
    expect(ShipmentsApi.update).toHaveBeenCalledWith('SHP-1', { status: 'Tender Accepted' });
  });

  it('cascades only the linked orders to "Tender Accepted" (status-only — dates frozen post-tender)', async () => {
    await acceptTender({ shipment, shipments: [shipment], orders });

    // ORD-1 and ORD-2 are linked, ORD-3 is unrelated.
    expect(updateOrderStatus).toHaveBeenCalledTimes(2);
    expect(updateOrderStatus).toHaveBeenCalledWith('ORD-1', 'Tender Accepted', expect.objectContaining({ id: 'ORD-1' }));
    expect(updateOrderStatus).toHaveBeenCalledWith('ORD-2', 'Tender Accepted', expect.objectContaining({ id: 'ORD-2' }));

    // Crucial: the cascade must NOT touch date fields. updateOrderStatus
    // itself only accepts a status string, so the contract is enforced
    // at the call boundary — this assert is a regression guard.
    const calls = (updateOrderStatus as jest.Mock).mock.calls;
    for (const args of calls) {
      expect(args[1]).toBe('Tender Accepted');
    }
  });

  it('pushes the accepted plan to OMS — the fix for "Awaiting TMS Plan"', async () => {
    await acceptTender({ shipment, shipments: [shipment], orders });

    expect(OmsApi.push).toHaveBeenCalledTimes(1);
    expect(OmsApi.push).toHaveBeenCalledWith(expect.objectContaining({
      shipmentId:    'SHP-1',
      carrier:       'JB Hunt',
      mode:          'TL',
      serviceLevel:  'STD',
      pickupDate:    '2026-04-30',
      deliveryDate:  '2026-05-02',
      dockNumber:    'Door 1',        // pulled from shipment.dock_door
      dockLoadStart: '2026-04-30 06:00',
      dockLoadEnd:   '2026-04-30 08:00',
      bolNumber:     'BOL-9',
      sealNumber:    'SEAL-1',
      orderIds:      ['ORD-1', 'ORD-2'],
    }));
  });

  it('broadcasts tender_accepted on the WS bridge so OMS / web tabs refresh without manual reload', async () => {
    await acceptTender({ shipment, shipments: [shipment], orders });

    expect(NotifyApi.broadcast).toHaveBeenCalledWith('tender_accepted', expect.objectContaining({
      shipmentId: 'SHP-1',
      orderIds:   ['ORD-1', 'ORD-2'],
      via:        'mobile-tms-accept',
    }));
  });

  it('passes carrier-supplied response fields through to OMS push when provided', async () => {
    await acceptTender({
      shipment,
      shipments: [shipment],
      orders,
      response: {
        proNumber: 'PRO-77',
        carrierPickupDate: '2026-05-01',
        dockDoor: 'Door 7',
        dockLoadStart: '2026-05-01 09:00',
        dockLoadEnd:   '2026-05-01 11:00',
      },
    });

    expect(OmsApi.push).toHaveBeenCalledWith(expect.objectContaining({
      proNumber:     'PRO-77',
      pickupDate:    '2026-05-01',
      dockNumber:    'Door 7',
      dockLoadStart: '2026-05-01 09:00',
      dockLoadEnd:   '2026-05-01 11:00',
    }));
  });

  it('returns ok=true with the partial-failure call-out when OMS push throws (best-effort downstream)', async () => {
    (OmsApi.push as jest.Mock).mockRejectedValue(new Error('network'));

    const out = await acceptTender({ shipment, shipments: [shipment], orders });

    expect(out.ok).toBe(true);
    expect(out.message).toMatch(/Tender accepted/);
    expect(out.message).toMatch(/OMS push failed/);
    expect(ShipmentsApi.update).toHaveBeenCalled();   // status flip still committed
  });

  it('returns ok=false when the shipment status flip itself fails (cascade + OMS never run)', async () => {
    (ShipmentsApi.update as jest.Mock).mockRejectedValue(new Error('db down'));

    const out = await acceptTender({ shipment, shipments: [shipment], orders });

    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/db down/);
    expect(updateOrderStatus).not.toHaveBeenCalled();
    expect(OmsApi.push).not.toHaveBeenCalled();
    expect(NotifyApi.broadcast).not.toHaveBeenCalled();
  });

  it('still calls OMS push when no linked orders are present (shipment-only mirror)', async () => {
    await acceptTender({ shipment, shipments: [shipment], orders: [] });

    expect(OmsApi.push).toHaveBeenCalledWith(expect.objectContaining({
      shipmentId: 'SHP-1',
      orderIds:   [],
    }));
  });

  it('handles MBOL fan-out: CBOL-linked orders are cascaded too', async () => {
    const master = { id: 'SHP-M', carrier: 'JB Hunt', bol_type: 'MBOL' };
    const child1 = { id: 'SHP-C1', master_shipment_id: 'SHP-M', bol_type: 'CBOL' };
    const child2 = { id: 'SHP-C2', master_shipment_id: 'SHP-M', bol_type: 'CBOL' };
    const allShipments = [master, child1, child2];
    const allOrders = [
      { id: 'ORD-A', shipment_id: 'SHP-C1', status: 'Tendered' },
      { id: 'ORD-B', shipment_id: 'SHP-C2', status: 'Tendered' },
      { id: 'ORD-C', shipment_id: 'SHP-OTHER', status: 'Tendered' },
    ];

    await acceptTender({ shipment: master, shipments: allShipments, orders: allOrders });

    expect(updateOrderStatus).toHaveBeenCalledTimes(2);
    expect(updateOrderStatus).toHaveBeenCalledWith('ORD-A', 'Tender Accepted', expect.any(Object));
    expect(updateOrderStatus).toHaveBeenCalledWith('ORD-B', 'Tender Accepted', expect.any(Object));
  });
});
