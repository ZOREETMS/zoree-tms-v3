/**
 * Unit tests for mobile/src/services/fleetService.ts (drivers + vehicles).
 *
 * DbApi is mocked.
 */

import {
  DRIVER_STATUSES,
  VEHICLE_STATUSES,
  buildBlankDriver,
  buildBlankVehicle,
  buildDriverFormFromRow,
  buildDriverPayload,
  buildVehicleFormFromRow,
  buildVehiclePayload,
  deleteDriver,
  deleteVehicle,
  saveDriver,
  saveVehicle,
  validateDriverForm,
  validateVehicleForm,
} from '../fleetService';
import { DbApi } from '../../lib/api';

jest.mock('../../lib/api', () => ({
  DbApi: {
    upsert: jest.fn(),
    patch: jest.fn(),
    remove: jest.fn(),
  },
}));

describe('enum exports', () => {
  it('exposes driver and vehicle status enums', () => {
    expect(DRIVER_STATUSES).toEqual(expect.arrayContaining(['Available', 'On Duty']));
    expect(VEHICLE_STATUSES).toEqual(expect.arrayContaining(['Available', 'In Transit']));
  });
});

describe('buildBlankDriver', () => {
  it('returns sane defaults', () => {
    const f = buildBlankDriver();
    expect(f.id).toMatch(/^DRV-\d{3}$/);
    expect(f.cdlClass).toBe('Class A');
    expect(f.status).toBe('Available');
    expect(f.endorsements).toEqual([]);
  });
});

describe('buildDriverFormFromRow', () => {
  it('returns blank form when row is null', () => {
    const f = buildDriverFormFromRow(null);
    expect(f.id).toMatch(/^DRV-/);
    expect(f.name).toBe('');
  });

  it('seeds from snake_case row, parses comma-separated endorsements', () => {
    const f = buildDriverFormFromRow({
      id: 'DRV-001',
      name: 'James Wilson',
      cdl_number: 'CDL-IL-123',
      cdl_class: 'Class A',
      assigned_vehicle: 'TRK-101',
      location: 'Chicago, IL',
      status: 'On Duty',
      hos_today: 9.5,
      endorsements: 'Hazmat, Tanker',
      phone: '555-1234',
    });
    expect(f.id).toBe('DRV-001');
    expect(f.name).toBe('James Wilson');
    expect(f.cdl).toBe('CDL-IL-123');
    expect(f.vehicle).toBe('TRK-101');
    expect(f.hosToday).toBe('9.5');
    expect(f.endorsements).toEqual(['Hazmat', 'Tanker']);
    expect(f.phone).toBe('555-1234');
  });

  it('handles array-shaped endorsements directly', () => {
    const f = buildDriverFormFromRow({ id: 'D-1', name: 'X', endorsements: ['Reefer'] });
    expect(f.endorsements).toEqual(['Reefer']);
  });
});

describe('validateDriverForm', () => {
  const base = buildBlankDriver();

  it('rejects missing id / name / cdl', () => {
    expect(validateDriverForm({ ...base, id: '' }).ok).toBe(false);
    expect(validateDriverForm({ ...base, id: 'D-1', name: '' }).ok).toBe(false);
    expect(validateDriverForm({ ...base, id: 'D-1', name: 'X', cdl: '' }).ok).toBe(false);
  });

  it('accepts a populated form', () => {
    const r = validateDriverForm({ ...base, name: 'Jane', cdl: 'CDL-1' });
    expect(r.ok).toBe(true);
  });
});

describe('buildDriverPayload', () => {
  it('coerces hosToday and persists endorsements as array', () => {
    const base = buildBlankDriver();
    const p = buildDriverPayload({
      ...base,
      name: 'Jane',
      cdl: 'CDL-1',
      hosToday: '10.5',
      endorsements: ['Hazmat'],
    });
    expect(p.hos_today).toBe(10.5);
    expect(p.endorsements).toEqual(['Hazmat']);
    expect(p.cdl_class).toBe('Class A');
  });

  it('persists optional fields as null when blank', () => {
    const base = buildBlankDriver();
    const p = buildDriverPayload({ ...base, name: 'Jane', cdl: 'CDL-1' });
    expect(p.vehicle).toBeNull();
    expect(p.location).toBeNull();
    expect(p.phone).toBeNull();
  });
});

describe('driver mutations', () => {
  beforeEach(() => jest.clearAllMocks());

  it('saveDriver routes new drivers through upsert', async () => {
    (DbApi.upsert as jest.Mock).mockResolvedValue(undefined);
    const base = buildBlankDriver();
    await saveDriver({ ...base, name: 'Jane', cdl: 'CDL-1' }, true);
    expect(DbApi.upsert).toHaveBeenCalledWith('drivers', expect.objectContaining({ name: 'Jane' }));
  });

  it('saveDriver routes edits through patch', async () => {
    (DbApi.patch as jest.Mock).mockResolvedValue(undefined);
    const base = buildBlankDriver();
    await saveDriver({ ...base, id: 'DRV-001', name: 'Jane', cdl: 'CDL-1' }, false);
    expect(DbApi.patch).toHaveBeenCalledWith(
      'drivers',
      'DRV-001',
      expect.objectContaining({ id: 'DRV-001' }),
    );
  });

  it('saveDriver rejects when validation fails', async () => {
    const base = buildBlankDriver();
    // name + cdl are required; CDL fires once name is set
    await expect(saveDriver({ ...base, name: 'Jane', cdl: '' }, true)).rejects.toThrow(/CDL/);
    expect(DbApi.upsert).not.toHaveBeenCalled();
  });

  it('deleteDriver requires an id', async () => {
    await expect(deleteDriver('')).rejects.toThrow(/id is required/);
  });

  it('deleteDriver calls DbApi.remove', async () => {
    (DbApi.remove as jest.Mock).mockResolvedValue(undefined);
    await deleteDriver('DRV-001');
    expect(DbApi.remove).toHaveBeenCalledWith('drivers', 'DRV-001');
  });
});

describe('vehicle helpers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('buildBlankVehicle has sane defaults', () => {
    const f = buildBlankVehicle();
    expect(f.type).toBe('Dry Van 53ft');
    expect(f.status).toBe('Available');
  });

  it('buildVehicleFormFromRow seeds from snake_case row', () => {
    const f = buildVehicleFormFromRow({
      unit: 'TRK-101', type: 'Reefer 48ft', next_pm: '2026-04-01', miles_ytd: 50000,
    });
    expect(f.unit).toBe('TRK-101');
    expect(f.nextPM).toBe('2026-04-01');
    expect(f.milesYTD).toBe('50000');
  });

  it('validateVehicleForm requires unit + type', () => {
    expect(validateVehicleForm({ ...buildBlankVehicle(), unit: '' }).ok).toBe(false);
    expect(validateVehicleForm({ ...buildBlankVehicle(), unit: 'TRK-1', type: '' }).ok).toBe(false);
    expect(validateVehicleForm({ ...buildBlankVehicle(), unit: 'TRK-1' }).ok).toBe(true);
  });

  it('buildVehiclePayload coerces miles + nulls optional fields', () => {
    const p = buildVehiclePayload({ ...buildBlankVehicle(), unit: 'TRK-1', milesYTD: '12345' });
    expect(p.miles_ytd).toBe(12345);
    expect(p.driver).toBeNull();
    expect(p.dest).toBeNull();
  });

  it('saveVehicle routes new through upsert, edits through patch', async () => {
    (DbApi.upsert as jest.Mock).mockResolvedValue(undefined);
    (DbApi.patch as jest.Mock).mockResolvedValue(undefined);
    await saveVehicle({ ...buildBlankVehicle(), unit: 'TRK-1' }, true);
    expect(DbApi.upsert).toHaveBeenCalledWith('vehicles', expect.objectContaining({ unit: 'TRK-1' }));
    await saveVehicle({ ...buildBlankVehicle(), unit: 'TRK-1' }, false);
    expect(DbApi.patch).toHaveBeenCalledWith('vehicles', 'TRK-1', expect.objectContaining({ unit: 'TRK-1' }));
  });

  it('deleteVehicle requires unit and calls remove', async () => {
    await expect(deleteVehicle('')).rejects.toThrow(/unit is required/);
    (DbApi.remove as jest.Mock).mockResolvedValue(undefined);
    await deleteVehicle('TRK-1');
    expect(DbApi.remove).toHaveBeenCalledWith('vehicles', 'TRK-1');
  });
});
