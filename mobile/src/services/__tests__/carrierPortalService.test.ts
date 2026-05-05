/**
 * Unit tests for mobile/src/services/carrierPortalService.ts.
 * DbApi is mocked.
 */

import {
  DEFAULT_PORTAL_CARRIER,
  buildNotesWithResponse,
  buildPersistedTenderResponses,
  effectiveShipmentStatus,
  extractTenderDefaults,
  getUniqueCarrierNames,
  isCarrierShipment,
  parseResponseFromNotes,
  pickActiveTenders,
  saveTenderResponse,
} from '../carrierPortalService';
import { DbApi, OmsApi } from '../../lib/api';

jest.mock('../../lib/api', () => ({
  DbApi: {
    patch: jest.fn(),
  },
  OmsApi: {
    push: jest.fn(),
  },
}));

describe('isCarrierShipment / getUniqueCarrierNames', () => {
  it('matches by fuzzy substring on normalized names', () => {
    expect(isCarrierShipment({ carrier: 'JB Hunt' }, 'JB Hunt')).toBe(true);
    expect(isCarrierShipment({ carrier: 'jb-hunt!!' }, 'JB Hunt')).toBe(true);
    expect(isCarrierShipment({ carrier: 'XPO' }, 'JB Hunt')).toBe(false);
    expect(isCarrierShipment(null, 'JB Hunt')).toBe(false);
  });

  it('extracts unique sorted carrier names, skipping the placeholder', () => {
    const names = getUniqueCarrierNames([
      { carrier: 'JB Hunt' },
      { carrier: 'JB Hunt' },        // dup
      { carrier: 'XPO Logistics' },
      { carrier: 'Carrier TBD' },     // skip placeholder
      {},
    ]);
    expect(names).toEqual(['JB Hunt', 'XPO Logistics']);
  });
});

describe('parseResponseFromNotes', () => {
  it('returns null when no marker present', () => {
    expect(parseResponseFromNotes('shipper handoff at noon')).toBeNull();
    expect(parseResponseFromNotes(null)).toBeNull();
  });

  it('parses the trailing marker payload', () => {
    const notes = 'free text here\n[CP_RESPONSE] {"action":"accept","proNumber":"PRO-123"}';
    const r = parseResponseFromNotes(notes);
    expect(r?.action).toBe('accept');
    expect(r?.proNumber).toBe('PRO-123');
  });

  it('returns null on malformed JSON', () => {
    expect(parseResponseFromNotes('text [CP_RESPONSE] not-json')).toBeNull();
  });
});

describe('buildNotesWithResponse', () => {
  it('appends the marker when notes were empty', () => {
    const notes = buildNotesWithResponse('', { action: 'accept' });
    expect(notes).toMatch(/^\[CP_RESPONSE\] /);
  });

  it('preserves existing prose and replaces older markers', () => {
    const original = 'shipper note\n[CP_RESPONSE] {"action":"reject"}';
    const next = buildNotesWithResponse(original, { action: 'accept' });
    expect(next).toMatch(/^shipper note\n\[CP_RESPONSE\] /);
    expect(next).toContain('"action":"accept"');
    // Round-trip through parser to confirm only one marker remains.
    expect(parseResponseFromNotes(next)?.action).toBe('accept');
  });
});

describe('buildPersistedTenderResponses', () => {
  it('indexes responses by shipment id', () => {
    const out = buildPersistedTenderResponses([
      { id: 'SHP-1', notes: '[CP_RESPONSE] {"action":"accept"}' },
      { id: 'SHP-2', notes: 'no marker here' },
      { id: 'SHP-3', notes: '[CP_RESPONSE] {"action":"reject","rejectReason":"capacity"}' },
      { notes: 'no id' },
    ]);
    expect(Object.keys(out).sort()).toEqual(['SHP-1', 'SHP-3']);
    expect(out['SHP-1'].action).toBe('accept');
    expect(out['SHP-3'].rejectReason).toBe('capacity');
  });
});

describe('effectiveShipmentStatus', () => {
  it('upgrades Tendered → Tender Accepted when notes carry an accept marker', () => {
    expect(effectiveShipmentStatus({ status: 'Tendered', notes: '[CP_RESPONSE] {"action":"accept"}' })).toBe('Tender Accepted');
  });

  it('keeps Tendered when reject marker present', () => {
    expect(effectiveShipmentStatus({ status: 'Tendered', notes: '[CP_RESPONSE] {"action":"reject"}' })).toBe('Tendered');
  });

  it('normalizes legacy "Confirmed" → "Tender Accepted"', () => {
    expect(effectiveShipmentStatus({ status: 'Confirmed' })).toBe('Tender Accepted');
  });

  it('returns the raw status otherwise (with em-dash for blank)', () => {
    expect(effectiveShipmentStatus({ status: 'Planned' })).toBe('Planned');
    expect(effectiveShipmentStatus({ status: '' })).toBe('—');
    expect(effectiveShipmentStatus(null)).toBe('');
  });
});

describe('pickActiveTenders', () => {
  const ships = [
    { id: 'A', carrier: 'JB Hunt', status: 'Tendered' },
    { id: 'B', carrier: 'JB Hunt', status: 'Planned' },        // wrong status
    { id: 'C', carrier: 'XPO', status: 'Tendered' },           // wrong carrier
    { id: 'D', carrier: 'JB Hunt', status: 'Tender Rejected' },
    { id: 'E', carrier: 'JB Hunt', status: 'Tendered', notes: '[CP_RESPONSE] {"action":"accept"}' },
  ];

  it('filters to active carrier and tender-life statuses', () => {
    const ids = pickActiveTenders(ships).map((s) => s.id).sort();
    expect(ids).toEqual(['A', 'D', 'E']);
  });

  it('honours an explicit active-carrier override', () => {
    expect(pickActiveTenders(ships, 'XPO').map((s) => s.id)).toEqual(['C']);
  });

  it('uses the default constant when carrier is omitted', () => {
    expect(DEFAULT_PORTAL_CARRIER).toBe('JB Hunt');
  });
});

describe('extractTenderDefaults', () => {
  it('returns blank strings when shipment is null', () => {
    expect(extractTenderDefaults(null)).toEqual({
      pickupDate: '', deliveryDate: '', dockDoor: '', dockLoadStart: '', dockLoadEnd: '',
    });
  });

  it('reads snake_case columns from a Supabase row', () => {
    const out = extractTenderDefaults({
      pickup_date: '2026-04-30',
      delivery_date: '2026-05-02',
      dock_door: 'Door 1',
      loading_start: '2026-04-30 06:00',
      loading_end: '2026-04-30 08:00',
    });
    expect(out).toEqual({
      pickupDate:    '2026-04-30',
      deliveryDate:  '2026-05-02',
      dockDoor:      'Door 1',
      dockLoadStart: '2026-04-30 06:00',
      dockLoadEnd:   '2026-04-30 08:00',
    });
  });

  it('falls back to camelCase aliases when snake_case absent', () => {
    const out = extractTenderDefaults({
      pickupDate: '2026-04-30',
      dockAssigned: 'Door 9',
    });
    expect(out.pickupDate).toBe('2026-04-30');
    expect(out.dockDoor).toBe('Door 9');
  });
});

describe('saveTenderResponse', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects when shipment has no id', async () => {
    await expect(saveTenderResponse({}, { action: 'accept' })).rejects.toThrow(/id is required/);
    await expect(saveTenderResponse(null, { action: 'accept' })).rejects.toThrow(/id is required/);
  });

  it('rejects unknown action', async () => {
    await expect(saveTenderResponse({ id: 'A' }, { action: 'maybe' as any })).rejects.toThrow(/accept.*reject/);
  });

  // QA #61 (2026-05-05): on accept, shipment status now flips to
  // 'Tender Accepted' so it tracks the linked orders. Until migration
  // 036 widened the shipments status CHECK constraint we kept it at
  // 'Tendered' as a workaround — that is no longer required.
  it('on accept: writes notes marker, status Tender Accepted, pro_number, pickup_date', async () => {
    (DbApi.patch as jest.Mock).mockResolvedValue({ ok: true });
    await saveTenderResponse(
      { id: 'SHP-1', carrier: 'JB Hunt', notes: 'orig note' },
      { action: 'accept', proNumber: 'PRO-9', carrierPickupDate: '2026-04-30' },
    );
    expect(DbApi.patch).toHaveBeenCalledWith(
      'shipments',
      'SHP-1',
      expect.objectContaining({
        status: 'Tender Accepted',
        pro_number: 'PRO-9',
        pickup_date: '2026-04-30',
        pickup: '2026-04-30',
      }),
    );
    const payload = (DbApi.patch as jest.Mock).mock.calls[0][2];
    expect(payload.notes).toMatch(/orig note/);
    expect(payload.notes).toMatch(/\[CP_RESPONSE\]/);
    expect(payload.notes).toMatch(/"action":"accept"/);
  });

  it('on accept: writes dock + delivery fields back to shipments (carrier override wins)', async () => {
    (DbApi.patch as jest.Mock).mockResolvedValue({ ok: true });
    await saveTenderResponse(
      {
        id: 'SHP-1', carrier: 'JB Hunt',
        pickup_date: '2026-04-30', delivery_date: '2026-05-02',
        dock_door: 'Door 1', loading_start: '2026-04-30 06:00', loading_end: '2026-04-30 08:00',
      },
      {
        action: 'accept',
        carrierPickupDate:   '2026-05-01',
        carrierDeliveryDate: '2026-05-03',
        dockDoor:            'Door 7',
        dockLoadStart:       '2026-05-01 09:00',
        dockLoadEnd:         '2026-05-01 11:00',
      },
    );
    expect(DbApi.patch).toHaveBeenCalledWith(
      'shipments',
      'SHP-1',
      expect.objectContaining({
        pickup_date:    '2026-05-01',
        pickup:         '2026-05-01',
        delivery_date:  '2026-05-03',
        dock_door:      'Door 7',
        loading_start:  '2026-05-01 09:00',
        loading_end:    '2026-05-01 11:00',
      }),
    );
  });

  it('on accept: falls back to shipment values when carrier omits a field', async () => {
    (DbApi.patch as jest.Mock).mockResolvedValue({ ok: true });
    await saveTenderResponse(
      {
        id: 'SHP-1', carrier: 'JB Hunt',
        pickup_date: '2026-04-30', delivery_date: '2026-05-02',
        dock_door: 'Door 1', loading_start: '2026-04-30 06:00', loading_end: '2026-04-30 08:00',
      },
      { action: 'accept' /* no overrides */ },
    );
    expect(DbApi.patch).toHaveBeenCalledWith(
      'shipments',
      'SHP-1',
      expect.objectContaining({
        pickup_date:    '2026-04-30',
        delivery_date:  '2026-05-02',
        dock_door:      'Door 1',
        loading_start:  '2026-04-30 06:00',
        loading_end:    '2026-04-30 08:00',
      }),
    );
  });

  it('on reject: status flips to "Tender Rejected"', async () => {
    (DbApi.patch as jest.Mock).mockResolvedValue({ ok: true });
    await saveTenderResponse(
      { id: 'SHP-1', carrier: 'JB Hunt' },
      { action: 'reject', rejectReason: 'capacity' },
    );
    expect(DbApi.patch).toHaveBeenCalledWith(
      'shipments',
      'SHP-1',
      expect.objectContaining({ status: 'Tender Rejected' }),
    );
  });

  it('on accept: cascades linked orders to "Tender Accepted" with dock + dates', async () => {
    (DbApi.patch as jest.Mock).mockResolvedValue({ ok: true });
    (OmsApi.push as jest.Mock).mockResolvedValue({ ok: true });
    await saveTenderResponse(
      {
        id: 'SHP-1', carrier: 'JB Hunt',
        delivery_date: '2026-05-02',
        dock_door: 'Door 1', loading_start: '2026-04-30 06:00', loading_end: '2026-04-30 08:00',
      },
      { action: 'accept', carrierPickupDate: '2026-04-30' },
      { orders: [{ id: 'ORD-1' }, { id: 'ORD-2' }] },
    );
    expect(DbApi.patch).toHaveBeenCalledWith('orders', 'ORD-1', expect.objectContaining({
      status: 'Tender Accepted',
      pickup: '2026-04-30',
      ready: '2026-04-30',
      pickup_date: '2026-04-30',
      delivery_date: '2026-05-02',
      dock_door: 'Door 1',
      loading_start: '2026-04-30 06:00',
      loading_end: '2026-04-30 08:00',
    }));
    expect(DbApi.patch).toHaveBeenCalledWith('orders', 'ORD-2', expect.objectContaining({
      status: 'Tender Accepted',
    }));
  });

  it('on accept: pushes the same fields to OMS via OmsApi.push', async () => {
    (DbApi.patch as jest.Mock).mockResolvedValue({ ok: true });
    (OmsApi.push as jest.Mock).mockResolvedValue({ ok: true });
    await saveTenderResponse(
      {
        id: 'SHP-1', carrier: 'JB Hunt', mode: 'TL',
        pickup_date: '2026-04-30', delivery_date: '2026-05-02',
        dock_door: 'Door 1', loading_start: '2026-04-30 06:00', loading_end: '2026-04-30 08:00',
        origin: 'Dallas', dest: 'Atlanta',
      },
      { action: 'accept', proNumber: 'PRO-9' },
      { orders: [{ id: 'ORD-1' }] },
    );
    expect(OmsApi.push).toHaveBeenCalledTimes(1);
    expect(OmsApi.push).toHaveBeenCalledWith(expect.objectContaining({
      shipmentId:    'SHP-1',
      pickupDate:    '2026-04-30',
      deliveryDate:  '2026-05-02',
      dockNumber:    'Door 1',
      dockLoadStart: '2026-04-30 06:00',
      dockLoadEnd:   '2026-04-30 08:00',
      proNumber:     'PRO-9',
      orderIds:      ['ORD-1'],
    }));
  });

  it('on accept: a failed OMS push does not unwind the TMS write', async () => {
    (DbApi.patch as jest.Mock).mockResolvedValue({ ok: true });
    (OmsApi.push as jest.Mock).mockRejectedValue(new Error('network'));
    const out = await saveTenderResponse(
      { id: 'SHP-1', carrier: 'JB Hunt' },
      { action: 'accept' },
      { orders: [{ id: 'ORD-1' }] },
    );
    expect(out.action).toBe('accept');
    expect(DbApi.patch).toHaveBeenCalledWith('shipments', 'SHP-1', expect.any(Object));
  });

  it('on accept with no orders: does not call OMS push (cascade-only path)', async () => {
    (DbApi.patch as jest.Mock).mockResolvedValue({ ok: true });
    await saveTenderResponse(
      { id: 'SHP-1', carrier: 'JB Hunt' },
      { action: 'accept' },
    );
    expect(OmsApi.push).not.toHaveBeenCalled();
  });

  it('on reject: orders are NOT cascaded', async () => {
    (DbApi.patch as jest.Mock).mockResolvedValue({ ok: true });
    await saveTenderResponse(
      { id: 'SHP-1', carrier: 'JB Hunt' },
      { action: 'reject' },
      { orders: [{ id: 'ORD-1' }] },
    );
    expect(DbApi.patch).toHaveBeenCalledTimes(1);
  });

  it('returns the normalized response object with carrierName + timestamps', async () => {
    (DbApi.patch as jest.Mock).mockResolvedValue({ ok: true });
    const out = await saveTenderResponse(
      { id: 'SHP-1', carrier: 'JB Hunt' },
      { action: 'accept' },
    );
    expect(out.carrierName).toBe('JB Hunt');
    expect(typeof out.respondedAt).toBe('string');
    expect(out.respondedAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
