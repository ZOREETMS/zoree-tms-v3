/**
 * Unit tests for mobile/src/services/equipmentService.ts.
 * DbApi is mocked.
 */

import {
  EQUIPMENT_STATUSES,
  SEED_EQUIPMENT,
  buildBlankEquipment,
  buildEquipmentFormFromRow,
  buildEquipmentPayload,
  computeEquipmentStats,
  deactivateEquipment,
  deleteEquipment,
  getEquipmentList,
  saveEquipment,
  validateEquipmentForm,
} from '../equipmentService';
import { DbApi } from '../../lib/api';

jest.mock('../../lib/api', () => ({
  DbApi: {
    upsert: jest.fn(),
    patch: jest.fn(),
    remove: jest.fn(),
  },
}));

describe('exports', () => {
  it('exposes a non-empty seed catalog', () => {
    expect(SEED_EQUIPMENT.length).toBeGreaterThan(5);
    for (const e of SEED_EQUIPMENT) {
      expect(typeof e.name).toBe('string');
      expect(typeof e.max_weight).toBe('number');
    }
  });

  it('exposes the status enum', () => {
    expect(EQUIPMENT_STATUSES).toEqual(['Active', 'Inactive']);
  });
});

describe('buildBlankEquipment', () => {
  it('returns sensible defaults', () => {
    const f = buildBlankEquipment();
    expect(f.status).toBe('Active');
    expect(f.temp_controlled).toBe(false);
    expect(f.hazmat_certified).toBe(false);
    expect(f.name).toBe('');
  });
});

describe('buildEquipmentFormFromRow', () => {
  it('returns blank form when row is null', () => {
    expect(buildEquipmentFormFromRow(null).status).toBe('Active');
  });

  it('preserves numeric fields as strings (form-shape)', () => {
    const f = buildEquipmentFormFromRow({
      id: 'EQ-001', name: 'Dry Van 53ft', code: 'DV53',
      max_weight: 45000, max_volume: 3800,
      length: 53, width: 8.5, height: 9,
      temp_controlled: false, hazmat_certified: true,
      status: 'Active',
    });
    expect(f.max_weight).toBe('45000');
    expect(f.max_volume).toBe('3800');
    expect(f.length).toBe('53');
    expect(f.width).toBe('8.5');
    expect(f.hazmat_certified).toBe(true);
    expect(f.temp_controlled).toBe(false);
  });
});

describe('validateEquipmentForm', () => {
  const base = buildBlankEquipment();

  it('rejects missing name', () => {
    const r = validateEquipmentForm({ ...base, name: '   ' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/name/i);
  });

  it('accepts a populated form', () => {
    const r = validateEquipmentForm({ ...base, name: 'Reefer 53ft' });
    expect(r.ok).toBe(true);
  });
});

describe('buildEquipmentPayload', () => {
  it('autogenerates id when missing, parses numerics, persists flags', () => {
    const base = buildBlankEquipment();
    const p = buildEquipmentPayload({
      ...base,
      name: 'Step Deck',
      max_weight: '43000',
      length: '48',
      width: '8.5',
      temp_controlled: true,
      hazmat_certified: false,
    });
    expect(p.id).toMatch(/^EQ-/);
    expect(p.max_weight).toBe(43000);
    expect(p.length).toBe(48);
    expect(p.width).toBeCloseTo(8.5, 1);
    expect(p.temp_controlled).toBe(true);
    expect(p.hazmat_certified).toBe(false);
  });

  it('keeps existing id on edit', () => {
    const base = buildBlankEquipment();
    const p = buildEquipmentPayload({ ...base, id: 'EQ-001', name: 'Dry Van 53ft' });
    expect(p.id).toBe('EQ-001');
  });

  it('coerces blank optionals to null / 0 deterministically', () => {
    const base = buildBlankEquipment();
    const p = buildEquipmentPayload({ ...base, name: 'Anything' });
    expect(p.code).toBeNull();
    expect(p.description).toBeNull();
    expect(p.max_weight).toBe(0);
  });
});

describe('getEquipmentList', () => {
  it('returns DB rows when present', () => {
    const dbRows = [{ id: 'EQ-X', name: 'Custom', status: 'Active' }];
    expect(getEquipmentList(dbRows)).toBe(dbRows);
  });

  it('falls back to SEED_EQUIPMENT when empty / missing', () => {
    expect(getEquipmentList()).toBe(SEED_EQUIPMENT);
    expect(getEquipmentList([])).toBe(SEED_EQUIPMENT);
  });
});

describe('mutations', () => {
  beforeEach(() => jest.clearAllMocks());

  it('saveEquipment rejects when validation fails', async () => {
    const base = buildBlankEquipment();
    await expect(saveEquipment({ ...base, name: '' })).rejects.toThrow(/name/i);
    expect(DbApi.upsert).not.toHaveBeenCalled();
  });

  it('saveEquipment upserts to equipment_types', async () => {
    (DbApi.upsert as jest.Mock).mockResolvedValue({ ok: true });
    const base = buildBlankEquipment();
    await saveEquipment({ ...base, name: 'Step Deck', max_weight: '43000' });
    expect(DbApi.upsert).toHaveBeenCalledWith(
      'equipment_types',
      expect.objectContaining({ name: 'Step Deck', max_weight: 43000 }),
    );
  });

  it('deactivateEquipment patches status to Inactive', async () => {
    await expect(deactivateEquipment('')).rejects.toThrow(/id is required/);
    (DbApi.patch as jest.Mock).mockResolvedValue({ ok: true });
    await deactivateEquipment('EQ-001');
    expect(DbApi.patch).toHaveBeenCalledWith('equipment_types', 'EQ-001', { status: 'Inactive' });
  });

  it('deleteEquipment requires an id and calls remove', async () => {
    await expect(deleteEquipment('')).rejects.toThrow(/id is required/);
    (DbApi.remove as jest.Mock).mockResolvedValue({ ok: true });
    await deleteEquipment('EQ-001');
    expect(DbApi.remove).toHaveBeenCalledWith('equipment_types', 'EQ-001');
  });
});

describe('computeEquipmentStats', () => {
  it('counts totals, active/inactive, refrigerated, hazmat', () => {
    const list = [
      { status: 'Active', temp_controlled: true, hazmat_certified: false },
      { status: 'Active', temp_controlled: false, hazmat_certified: true },
      { status: 'Inactive', temp_controlled: false, hazmat_certified: false },
      { status: 'Active', temp_controlled: true, hazmat_certified: true },
    ];
    const s = computeEquipmentStats(list);
    expect(s.total).toBe(4);
    expect(s.active).toBe(3);
    expect(s.inactive).toBe(1);
    expect(s.refrigerated).toBe(2);
    expect(s.hazmat).toBe(2);
  });

  it('treats missing status as Active', () => {
    expect(computeEquipmentStats([{}, {}]).active).toBe(2);
  });
});
