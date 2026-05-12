/**
 * Unit tests for mobile/src/services/shipmentTenderService.ts
 *
 * Regression coverage for the "Tender Failed: no email in 'to'"
 * bug — the mobile detail screen used to call /api/tender/email
 * with no `to` field and with wrong server field names. These
 * tests pin both:
 *
 *   1. `to` is resolved from the carriers list (not the screen).
 *   2. The payload uses the server's field contract
 *      (`dest`, `pickup`, `delivery`) — NOT the vm-shaped
 *      camelCase (`destination`, `pickupDate`, `deliveryDate`).
 */

import {
  buildTenderPayload,
  sendShipmentTender,
} from '../shipmentTenderService';
import { TenderApi } from '../../shared/api';

jest.mock('../../shared/api', () => ({
  TenderApi: {
    sendEmail: jest.fn(),
  },
}));

const sendEmailMock = TenderApi.sendEmail as unknown as jest.Mock;

function makeVm(overrides: any = {}) {
  return {
    id: 'SHP-2026-0042',
    status: 'Planned',
    carrier: 'Acme Trucking',
    mode: 'TL',
    equipment: 'Dry Van',
    equipmentSource: 'shipment' as const,
    origin: 'Dallas, TX',
    destination: 'Atlanta, GA',
    shipFromName: null,
    shipToName: null,
    pickupDate: '2026-05-15',
    deliveryDate: '2026-05-17',
    transitDays: '2',
    weight: 12500,
    pieces: 18,
    commodity: 'General Freight',
    rateId: null,
    serviceLevel: null,
    proNumber: null,
    bolNumber: null,
    sealNumber: null,
    dockDoor: 'Door 3',
    dockTime: '07:00–09:00',
    loadingStart: null,
    loadingEnd: null,
    cost: { base: 1000, fuel: 100, accessorials: 0, total: 1100, baseIsDerived: false } as any,
    discount: { hasDiscount: false, pct: 0, flat: 0, amount: 0 } as any,
    fscPct: '',
    notes: null,
    linkedOrders: [
      { id: 'ORD-1', customer: 'Cust A' },
      { id: 'ORD-2', customer: 'Cust A' },
      { id: 'ORD-3', customer: 'Cust B' },
    ],
    ...overrides,
  };
}

describe('buildTenderPayload', () => {
  it('uses the server field contract (dest/pickup/delivery, not vm names)', () => {
    const p = buildTenderPayload(makeVm(), { total_cost: 1100 });
    expect(p.dest).toBe('Atlanta, GA');
    expect(p.pickup).toBe('2026-05-15');
    expect(p.delivery).toBe('2026-05-17');
    // The bug was these vm-style keys leaking through — they must
    // NOT appear on the payload object.
    expect(Object.keys(p)).not.toContain('destination');
    expect(Object.keys(p)).not.toContain('pickupDate');
    expect(Object.keys(p)).not.toContain('deliveryDate');
  });

  it('derives orderNumbers + customerName from linkedOrders', () => {
    const p = buildTenderPayload(makeVm(), {});
    expect(p.orderNumbers).toEqual(['ORD-1', 'ORD-2', 'ORD-3']);
    expect(p.customerName).toBe('Cust A, Cust B');
  });

  it('falls back to shipment.total_cost when vm.cost.total is missing', () => {
    const vm = makeVm({ cost: { total: null } as any });
    const p = buildTenderPayload(vm, { total_cost: 4242 });
    expect(p.cost).toBe(4242);
  });
});

describe('sendShipmentTender', () => {
  beforeEach(() => {
    sendEmailMock.mockReset();
  });

  it('returns a missing_email message when the carriers list has no email for the carrier', async () => {
    const result = await sendShipmentTender({
      vm: makeVm(),
      shipment: {},
      carriers: [{ name: 'Acme Trucking', email: '' }],
    });
    expect(result.ok).toBe(false);
    expect(result.sent).toBe(false);
    expect(result.message).toMatch(/No email on file/i);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('injects `to` from the carriers list and POSTs with server field names', async () => {
    sendEmailMock.mockResolvedValueOnce({ sent: true });
    const result = await sendShipmentTender({
      vm: makeVm(),
      shipment: { total_cost: 1100 },
      carriers: [{ name: 'Acme Trucking', email: 'dispatch@acme.test' }],
    });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const sentPayload = sendEmailMock.mock.calls[0][0];
    expect(sentPayload.to).toBe('dispatch@acme.test');
    expect(sentPayload.contactEmail).toBe('dispatch@acme.test');
    expect(sentPayload.dest).toBe('Atlanta, GA');
    expect(sentPayload.pickup).toBe('2026-05-15');
    expect(sentPayload.delivery).toBe('2026-05-17');
    expect(result.ok).toBe(true);
    expect(result.sent).toBe(true);
    expect(result.to).toBe('dispatch@acme.test');
  });

  it('refuses to send when the shipment has no carrier assigned', async () => {
    const result = await sendShipmentTender({
      vm: makeVm({ carrier: '—' }),
      shipment: {},
      carriers: [{ name: 'Acme Trucking', email: 'dispatch@acme.test' }],
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no carrier assigned/i);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('surfaces the SMTP-not-configured branch as a non-error message', async () => {
    sendEmailMock.mockResolvedValueOnce({
      sent: false,
      skipped: 'smtp',
      message: 'SMTP not configured; tender saved but email not sent.',
      draftTo: 'dispatch@acme.test',
    });
    const result = await sendShipmentTender({
      vm: makeVm(),
      shipment: {},
      carriers: [{ name: 'Acme Trucking', email: 'dispatch@acme.test' }],
    });
    expect(result.ok).toBe(false);
    expect(result.sent).toBe(false);
    expect(result.message).toMatch(/SMTP/i);
  });
});
