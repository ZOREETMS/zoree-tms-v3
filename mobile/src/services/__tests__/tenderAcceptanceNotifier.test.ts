/**
 * Unit tests for mobile/src/services/tenderAcceptanceNotifier.ts.
 *
 * OmsApi and NotifyApi are mocked. The contract under test is the
 * payload shape that hits POST /api/oms/push (parity with the web
 * tenderAcceptanceNotifier.js) plus the "broadcast happens even if
 * OMS push fails, and vice-versa" best-effort guarantee.
 */

import { propagateTenderAcceptance } from '../tenderAcceptanceNotifier';
import { OmsApi, NotifyApi } from '../../lib/api';

jest.mock('../../lib/api', () => ({
  OmsApi: {
    push: jest.fn(),
  },
  NotifyApi: {
    broadcast: jest.fn(),
  },
}));

const baseShipment = {
  id: 'SHP-1',
  carrier: 'JB Hunt',
  mode: 'TL',
  service_level: 'STD',
  pickup_date: '2026-04-30',
  delivery_date: '2026-05-02',
  bol_number: 'BOL-9',
  seal_number: 'SEAL-1',
  origin: 'Dallas',
  dest: 'Atlanta',
  weight: 1000,
  pieces: 4,
  commodity: 'PALLETS',
  cost: 2500,
};

describe('propagateTenderAcceptance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (OmsApi.push as jest.Mock).mockResolvedValue({ ok: true });
    (NotifyApi.broadcast as jest.Mock).mockResolvedValue({ ok: true });
  });

  it('returns an empty result with no side-effects when shipment or response is missing', async () => {
    const out = await propagateTenderAcceptance({
      shipment: null as any,
      response: { proNumber: 'X' },
      orderIds: ['ORD-1'],
    });
    expect(out).toEqual({
      omsResult:   null,
      omsError:    null,
      notified:    false,
      notifyError: null,
    });
    expect(OmsApi.push).not.toHaveBeenCalled();
    expect(NotifyApi.broadcast).not.toHaveBeenCalled();
  });

  it('pushes the canonical OMS payload — response.* wins, shipment.* falls back, empties become ""', async () => {
    await propagateTenderAcceptance({
      shipment: baseShipment,
      response: {
        proNumber: 'PRO-77',
        carrierPickupDate: '2026-05-01',  // overrides shipment.pickup_date
        // serviceLevel omitted → falls back to shipment.service_level
        dockDoor: 'Door 7',
        dockLoadStart: '2026-05-01 09:00',
        dockLoadEnd:   '2026-05-01 11:00',
      },
      orderIds: ['ORD-1', 'ORD-2'],
    });

    expect(OmsApi.push).toHaveBeenCalledTimes(1);
    expect(OmsApi.push).toHaveBeenCalledWith(expect.objectContaining({
      shipmentId:    'SHP-1',
      carrier:       'JB Hunt',
      mode:          'TL',
      serviceLevel:  'STD',                // fallback from shipment
      pickupDate:    '2026-05-01',         // carrier override
      deliveryDate:  '2026-05-02',         // shipment fallback (no response.delivery)
      proNumber:     'PRO-77',
      bolNumber:     'BOL-9',              // shipment fallback
      sealNumber:    'SEAL-1',
      dockNumber:    'Door 7',
      dockLoadStart: '2026-05-01 09:00',
      dockLoadEnd:   '2026-05-01 11:00',
      origin:        'Dallas',
      destination:   'Atlanta',
      weight:        1000,
      pieces:        4,
      commodity:     'PALLETS',
      cost:          2500,
      orderIds:      ['ORD-1', 'ORD-2'],
      notes:         '',
    }));
  });

  it('broadcasts tender_accepted with shipment id, pro number, and order ids', async () => {
    await propagateTenderAcceptance({
      shipment: baseShipment,
      response: { proNumber: 'PRO-77' },
      orderIds: ['ORD-1'],
    });

    expect(NotifyApi.broadcast).toHaveBeenCalledTimes(1);
    expect(NotifyApi.broadcast).toHaveBeenCalledWith('tender_accepted', {
      shipmentId: 'SHP-1',
      proNumber:  'PRO-77',
      orderIds:   ['ORD-1'],
      via:        'mobile-tms-accept',
    });
  });

  it('still broadcasts when the OMS push throws (best-effort, both independent)', async () => {
    (OmsApi.push as jest.Mock).mockRejectedValue(new Error('oms boom'));

    const out = await propagateTenderAcceptance({
      shipment: baseShipment,
      response: {},
      orderIds: [],
    });

    expect(out.omsError).toMatch(/oms boom/);
    expect(out.omsResult).toBeNull();
    expect(out.notified).toBe(true);
    expect(out.notifyError).toBeNull();
    expect(NotifyApi.broadcast).toHaveBeenCalledTimes(1);
  });

  it('still reports OMS success when the broadcast throws', async () => {
    (NotifyApi.broadcast as jest.Mock).mockRejectedValue(new Error('ws boom'));

    const out = await propagateTenderAcceptance({
      shipment: baseShipment,
      response: {},
      orderIds: [],
    });

    expect(out.omsError).toBeNull();
    expect(out.omsResult).toEqual({ ok: true });
    expect(out.notified).toBe(false);
    expect(out.notifyError).toMatch(/ws boom/);
  });

  it('filters out falsy / non-string order ids before pushing', async () => {
    await propagateTenderAcceptance({
      shipment: baseShipment,
      response: {},
      orderIds: ['ORD-1', '', null as any, undefined as any, 'ORD-2'],
    });

    expect(OmsApi.push).toHaveBeenCalledWith(expect.objectContaining({
      orderIds: ['ORD-1', 'ORD-2'],
    }));
    expect(NotifyApi.broadcast).toHaveBeenCalledWith('tender_accepted', expect.objectContaining({
      orderIds: ['ORD-1', 'ORD-2'],
    }));
  });
});
