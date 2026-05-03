/**
 * Unit tests for mobile/src/services/shipmentService.ts.
 */

import {
  buildBlankShipment,
  buildShipmentPayload,
  composeOriginDest,
  copyShipment,
  createShipment,
  deleteShipmentById,
  deriveShipmentEquipment,
  generateShipmentId,
  updateShipmentStatus,
  validateShipmentForm,
} from '../shipmentService';
import { DbApi, ShipmentsApi } from '../../lib/api';

jest.mock('../../lib/api', () => ({
  DbApi: {
    upsert: jest.fn(),
    remove: jest.fn(),
  },
  // QA bug #57 + #63: deleteShipmentById and updateShipmentStatus now
  // route through the service-layer ShipmentsApi (not the raw DbApi).
  ShipmentsApi: {
    remove: jest.fn(),
    updateStatus: jest.fn(),
  },
}));

describe('generateShipmentId', () => {
  it('matches the SHP-YYYY-NNNN format', () => {
    expect(generateShipmentId()).toMatch(/^SHP-\d{4}-\d{4}$/);
  });

  it('produces unique-ish ids across rapid calls', () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) ids.add(generateShipmentId());
    expect(ids.size).toBeGreaterThan(40);
  });
});

describe('buildBlankShipment', () => {
  it('returns sane defaults for the create modal', () => {
    const f = buildBlankShipment();
    expect(f.mode).toBe('LTL');
    expect(f.service_level).toBe('Standard');
    expect(f.pickup_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(f.delivery_date).toBe('');
    expect(f.weight).toBe('');
    expect(f.pieces).toBe('');
  });
});

describe('composeOriginDest', () => {
  it('builds CITY, ST ZIP from structured form fields', () => {
    const f = buildBlankShipment();
    const { origin, dest } = composeOriginDest({
      ...f,
      originCity: 'Chicago',
      originState: 'il',
      originZip: '60601',
      destCity: 'Dallas',
      destState: 'tx',
      destZip: '75201',
    });
    expect(origin).toBe('Chicago, IL 60601');
    expect(dest).toBe('Dallas, TX 75201');
  });

  it('omits blank parts gracefully', () => {
    const f = buildBlankShipment();
    const { origin, dest } = composeOriginDest({
      ...f,
      originCity: 'Chicago',
      originState: '',
      originZip: '',
      destCity: '',
      destState: '',
      destZip: '',
    });
    expect(origin).toBe('Chicago');
    expect(dest).toBe('');
  });
});

describe('buildShipmentPayload', () => {
  const base = buildBlankShipment();

  it('coerces numeric fields and trims equipment', () => {
    const p = buildShipmentPayload({
      ...base,
      originCity: 'Chicago',
      originState: 'IL',
      destCity: 'Dallas',
      destState: 'TX',
      weight: '1500',
      pieces: '12',
      total_cost: '1234.56',
      equipment: '  Dry Van 53ft  ',
    });
    expect(p.weight).toBe(1500);
    expect(p.pieces).toBe(12);
    expect(p.total_cost).toBeCloseTo(1234.56, 2);
    expect(p.equipment).toBe('Dry Van 53ft');
    expect(p.status).toBe('Planned');
  });

  it('persists equipment as null when blank', () => {
    const p = buildShipmentPayload({ ...base, equipment: '   ' });
    expect(p.equipment).toBeNull();
  });

  it('persists nullable date fields as null when blank', () => {
    const p = buildShipmentPayload({ ...base, pickup_date: '', delivery_date: '' });
    expect(p.pickup_date).toBeNull();
    expect(p.delivery_date).toBeNull();
  });
});

describe('validateShipmentForm', () => {
  const base = buildBlankShipment();

  it('rejects when origin city is missing', () => {
    const r = validateShipmentForm({ ...base, originCity: '', destCity: 'Dallas' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Origin/);
  });

  it('rejects when destination city is missing', () => {
    const r = validateShipmentForm({ ...base, originCity: 'Chicago', destCity: '' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Destination/);
  });

  it('accepts when both origin and dest cities are present', () => {
    const r = validateShipmentForm({ ...base, originCity: 'Chicago', destCity: 'Dallas' });
    expect(r.ok).toBe(true);
  });
});

describe('createShipment', () => {
  beforeEach(() => jest.clearAllMocks());

  it('upserts to shipments table with a generated id', async () => {
    (DbApi.upsert as jest.Mock).mockResolvedValue(undefined);
    const result = await createShipment({
      ...buildBlankShipment(),
      originCity: 'Chicago',
      originState: 'IL',
      destCity: 'Dallas',
      destState: 'TX',
      weight: '500',
    });
    expect(result.id).toMatch(/^SHP-\d{4}-\d{4}$/);
    expect(result.status).toBe('Planned');
    expect(DbApi.upsert).toHaveBeenCalledWith(
      'shipments',
      expect.objectContaining({
        id: result.id,
        origin: 'Chicago, IL',
        dest: 'Dallas, TX',
        weight: 500,
      }),
    );
  });
});

describe('copyShipment', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects non-objects', async () => {
    await expect(copyShipment(null as any)).rejects.toThrow(/source shipment is required/);
  });

  it('upserts a fresh row with a new id and reset state', async () => {
    (DbApi.upsert as jest.Mock).mockResolvedValue(undefined);
    const out = await copyShipment({
      id: 'SHP-2025-0001',
      origin: 'Chicago, IL 60601',
      dest: 'Dallas, TX 75201',
      mode: 'TL',
      carrier: 'XPO',
      weight: 1500,
      pieces: 12,
      total_cost: 1234.5,
      service_level: 'Expedited',
      equipment: 'Dry Van 53ft',
      notes: 'note',
      // NOT copied:
      order_ids: ['ORD-1', 'ORD-2'],
      bol_type: 'MBOL',
      master_shipment_id: 'SHP-MASTER',
    });
    expect(out.id).toMatch(/^SHP-\d{4}-\d{4}$/);
    expect(out.id).not.toBe('SHP-2025-0001');
    expect(out.status).toBe('Planned');
    // QA bug #56 fix: delivery_date now null (not '') so Postgres
    // accepts the upsert. Empty string was rejected as a date value.
    expect(out.delivery_date).toBeNull();
    expect(out.equipment).toBe('Dry Van 53ft');
    expect((out as any).order_ids).toBeUndefined();
    expect((out as any).bol_type).toBeUndefined();
    expect((out as any).master_shipment_id).toBeUndefined();
    expect(DbApi.upsert).toHaveBeenCalledWith('shipments', expect.objectContaining({ id: out.id }));
  });
});

describe('deleteShipmentById', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects empty id', async () => {
    await expect(deleteShipmentById('')).rejects.toThrow(/id is required/);
    expect(ShipmentsApi.remove).not.toHaveBeenCalled();
  });

  // QA bug #57 fix: routed through ShipmentsApi.remove (service-layer
  // endpoint) instead of DbApi.remove, so the server can cascade
  // orders back to Unplanned with shipment_id=null.
  it('calls ShipmentsApi.remove (server-side cascade)', async () => {
    (ShipmentsApi.remove as jest.Mock).mockResolvedValue({ ok: true });
    await deleteShipmentById('SHP-2026-0001');
    expect(ShipmentsApi.remove).toHaveBeenCalledWith('SHP-2026-0001');
    expect(DbApi.remove).not.toHaveBeenCalled();
  });
});

describe('updateShipmentStatus', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects empty id', async () => {
    await expect(updateShipmentStatus('', 'Tendered')).rejects.toThrow(/id is required/);
    expect(ShipmentsApi.updateStatus).not.toHaveBeenCalled();
  });

  it('rejects empty status', async () => {
    await expect(updateShipmentStatus('SHP-1', '')).rejects.toThrow(/status is required/);
    expect(ShipmentsApi.updateStatus).not.toHaveBeenCalled();
  });

  // QA bug #63: routes through the service-layer status endpoint
  // (PATCH /api/shipments/:id/status) which validates against the
  // canonical enum AND fires the order cascade in shipmentEvents.
  it('calls ShipmentsApi.updateStatus with id + status', async () => {
    (ShipmentsApi.updateStatus as jest.Mock).mockResolvedValue({ ok: true });
    await updateShipmentStatus('SHP-2026-0001', 'Tendered');
    expect(ShipmentsApi.updateStatus).toHaveBeenCalledWith('SHP-2026-0001', 'Tendered');
  });
});

describe('deriveShipmentEquipment', () => {
  it('prefers the shipment-stored value', () => {
    const r = deriveShipmentEquipment(
      { equipment: 'Reefer 53ft' },
      { equipment: 'Dry Van 53ft' },
    );
    expect(r).toEqual({ value: 'Reefer 53ft', source: 'shipment' });
  });

  it('falls back to the rate row when shipment.equipment is empty', () => {
    const r = deriveShipmentEquipment({ equipment: '' }, { equipment: 'Dry Van 53ft' });
    expect(r).toEqual({ value: 'Dry Van 53ft', source: 'rate' });
  });

  it('returns null source when neither side has a value', () => {
    expect(deriveShipmentEquipment({}, {})).toEqual({ value: null, source: null });
    expect(deriveShipmentEquipment(null, null)).toEqual({ value: null, source: null });
  });

  it('treats whitespace-only strings as empty (matches web)', () => {
    const r = deriveShipmentEquipment({ equipment: '   ' }, { equipment: 'LTL' });
    expect(r).toEqual({ value: 'LTL', source: 'rate' });
  });
});
