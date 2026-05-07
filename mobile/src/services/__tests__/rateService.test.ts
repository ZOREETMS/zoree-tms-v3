/**
 * Unit tests for mobile/src/services/rateService.ts.
 *
 * Covers: pure helpers (normalizeMatchType, normalizeUnit, parseLocation,
 * isLtlMode), form seeding (buildInitialRateForm), payload mapping
 * (buildRatePayload), validation (validateRateForm), and mutations
 * (saveRate / deleteRate / duplicateRate).
 *
 * The DbApi module is mocked so tests stay deterministic and never
 * hit the real backend.
 */

import {
  MATCH_TYPE_VALUES,
  MATCH_TYPE_OPTIONS,
  MODE_OPTIONS,
  STATUS_OPTIONS,
  SERVICE_LEVEL_OPTIONS,
  UNIT_OPTIONS,
  FREIGHT_CLASSES,
  DEFAULT_EQUIPMENT_BY_MODE,
  SEED_EQUIPMENT,
  applyRateFieldChange,
  normalizeMatchType,
  getMatchTypeLabel,
  normalizeUnit,
  parseLocation,
  isLtlMode,
  getField,
  buildInitialRateForm,
  buildRatePayload,
  validateRateForm,
  saveRate,
  deleteRate,
  duplicateRate,
} from '../rateService';
import { DbApi } from '../../lib/api';

jest.mock('../../lib/api', () => ({
  DbApi: {
    upsert: jest.fn(),
    patch: jest.fn(),
    remove: jest.fn(),
  },
}));

describe('enum exports', () => {
  it('exposes the same match-type values as the web', () => {
    expect(MATCH_TYPE_VALUES.CITY).toBe('city_to_city');
    expect(MATCH_TYPE_VALUES.ZIP).toBe('zip_to_zip');
    expect(MATCH_TYPE_VALUES.COUNTRY).toBe('country_to_country');
    expect(MATCH_TYPE_OPTIONS).toHaveLength(3);
  });

  it('exposes the canonical mode / status / service-level / unit / class lists', () => {
    expect(MODE_OPTIONS).toContain('TL');
    expect(MODE_OPTIONS).toContain('LTL');
    expect(STATUS_OPTIONS).toEqual(expect.arrayContaining(['Active', 'Expiring', 'Expired']));
    expect(SERVICE_LEVEL_OPTIONS).toContain('Standard');
    expect(UNIT_OPTIONS.map((u) => u.value)).toEqual(
      expect.arrayContaining(['per mile', 'per cwt', 'flat', 'container']),
    );
    expect(FREIGHT_CLASSES).toContain('70');
    expect(FREIGHT_CLASSES).toContain('300');
  });

  it('exposes a non-empty equipment seed list with the expected shape', () => {
    expect(Array.isArray(SEED_EQUIPMENT)).toBe(true);
    expect(SEED_EQUIPMENT.length).toBeGreaterThan(0);
    for (const eq of SEED_EQUIPMENT) {
      expect(typeof eq.name).toBe('string');
      expect(typeof eq.max_weight).toBe('number');
    }
  });

  it('maps modes to default equipment values', () => {
    expect(DEFAULT_EQUIPMENT_BY_MODE.LTL).toBe('LTL');
    expect(DEFAULT_EQUIPMENT_BY_MODE.TL).toBe('Dry Van 53ft');
  });
});

describe('normalizeMatchType / getMatchTypeLabel', () => {
  it('normalizes legacy or partial values to a canonical match type', () => {
    expect(normalizeMatchType('zip_to_zip')).toBe(MATCH_TYPE_VALUES.ZIP);
    expect(normalizeMatchType('ZIP_TO_ZIP')).toBe(MATCH_TYPE_VALUES.ZIP);
    expect(normalizeMatchType('zip-to-zip')).toBe(MATCH_TYPE_VALUES.ZIP);
    expect(normalizeMatchType('country_to_country')).toBe(MATCH_TYPE_VALUES.COUNTRY);
    expect(normalizeMatchType(undefined)).toBe(MATCH_TYPE_VALUES.CITY);
    expect(normalizeMatchType('garbage')).toBe(MATCH_TYPE_VALUES.CITY);
  });

  it('returns the human label for a match type', () => {
    expect(getMatchTypeLabel(MATCH_TYPE_VALUES.ZIP)).toBe('Zip to Zip');
    expect(getMatchTypeLabel(undefined)).toBe('City to City');
  });
});

describe('normalizeUnit', () => {
  it('snaps loose values onto the canonical select options', () => {
    expect(normalizeUnit('per mile')).toBe('per mile');
    expect(normalizeUnit('PER MILE')).toBe('per mile');
    expect(normalizeUnit('$/mile')).toBe('per mile');
    expect(normalizeUnit('per cwt')).toBe('per cwt');
    expect(normalizeUnit('Per CWT')).toBe('per cwt');
    expect(normalizeUnit('Flat')).toBe('flat');
    expect(normalizeUnit('Container')).toBe('container');
    expect(normalizeUnit('')).toBe('per mile');
    expect(normalizeUnit(null)).toBe('per mile');
  });
});

describe('isLtlMode', () => {
  it('is true for LTL only (case-insensitive)', () => {
    expect(isLtlMode('LTL')).toBe(true);
    expect(isLtlMode('ltl')).toBe(true);
    expect(isLtlMode('TL')).toBe(false);
    expect(isLtlMode('')).toBe(false);
    expect(isLtlMode(null)).toBe(false);
  });
});

describe('parseLocation', () => {
  it('extracts city / state / zip from a free-text address', () => {
    expect(parseLocation('Chicago, IL 60601')).toEqual({ city: 'Chicago', state: 'IL', zip: '60601' });
    expect(parseLocation('Dallas, TX')).toEqual({ city: 'Dallas', state: 'TX', zip: '' });
    expect(parseLocation('60601 Chicago, IL')).toEqual({ city: 'Chicago', state: 'IL', zip: '60601' });
    expect(parseLocation('')).toEqual({ city: '', state: '', zip: '' });
  });
});

describe('getField', () => {
  it('returns the first non-empty key', () => {
    expect(getField({ b: 'B', a: '' }, 'a', 'b')).toBe('B');
    // Numeric 0 is a meaningful rate value (e.g. a $0 minimum-charge
    // override). The function's contract is "first non-empty" where
    // empty = undefined / null / empty string only — numeric 0 passes
    // through. The previous expectation here ("0 → ''") contradicted
    // both the JSDoc and the implementation's `!== ''` check, and
    // would have silently zeroed-out legitimate rate fields if the
    // implementation were "fixed" to match.
    expect(getField({ a: 0 }, 'a')).toBe(0);
    expect(getField({}, 'a')).toBe('');
  });

  it('treats null / undefined / "" as empty and continues to the next key', () => {
    expect(getField({ a: null, b: undefined, c: '', d: 'X' }, 'a', 'b', 'c', 'd')).toBe('X');
  });
});

describe('buildInitialRateForm', () => {
  it('returns sensible defaults when given no rate (create flow)', () => {
    const f = buildInitialRateForm();
    expect(f.lane).toBe('');
    expect(f.mode).toBe('TL');
    expect(f.matchType).toBe(MATCH_TYPE_VALUES.CITY);
    expect(f.status).toBe('Active');
    expect(f.unit).toBe('per mile');
    expect(f.czarlite).toBe(false);
    expect(f.czarliteClass).toBe('70');
  });

  it('seeds from a snake_case DB row, preferring structured columns', () => {
    const f = buildInitialRateForm({
      lane: 'CHI-LAX-001',
      mode: 'LTL',
      origin: 'Chicago, IL 60601',
      origin_zip: '60602',
      origin_country: 'USA',
      dest: 'Los Angeles, CA 90001',
      dest_zip: '90001',
      carrier: 'XPO',
      rate: '$2.50',
      fsc: '18.5%',
      czarlite: true,
      match_type: 'zip-to-zip',
    });
    expect(f.lane).toBe('CHI-LAX-001');
    expect(f.mode).toBe('LTL');
    expect(f.matchType).toBe(MATCH_TYPE_VALUES.ZIP);
    expect(f.originCity).toBe('Chicago');
    expect(f.originState).toBe('IL');
    expect(f.originZip).toBe('60602'); // structured column wins
    expect(f.destZip).toBe('90001');
    expect(f.rate).toBe('2.50'); // $ stripped
    expect(f.fsc).toBe('18.5'); // % stripped
    expect(f.czarlite).toBe(true);
  });
});

describe('buildRatePayload', () => {
  const base = buildInitialRateForm();

  it('rebuilds origin/dest strings from the structured form fields', () => {
    const payload = buildRatePayload({
      ...base,
      originCity: 'Chicago',
      originState: 'il',
      originZip: '60601',
      destCity: 'Dallas',
      destState: 'tx',
      destZip: '75201',
    });
    expect(payload.origin).toBe('Chicago, IL 60601');
    expect(payload.dest).toBe('Dallas, TX 75201');
    expect(payload.origin_zip).toBe('60601');
    expect(payload.dest_zip).toBe('75201');
    expect(payload.origin_country).toBe('USA');
    expect(payload.dest_country).toBe('USA');
  });

  it('formats rate as $ string and FSC as % string', () => {
    const payload = buildRatePayload({ ...base, rate: '2.5', fsc: '18.5' });
    expect(payload.rate).toBe('$2.50');
    expect(payload.fsc).toBe('18.5%');
  });

  it('coerces optional numerics to numbers or null', () => {
    const blank = buildRatePayload(base);
    expect(blank.discount).toBeNull();
    expect(blank.discount_flat).toBeNull();
    expect(blank.miles).toBeNull();
    expect(blank.transit_days).toBeNull();
    expect(blank.eff).toBeNull();
    expect(blank.exp).toBeNull();

    const filled = buildRatePayload({
      ...base,
      discount: '5',
      discountFlat: '50',
      miles: '2015',
      transitDays: '3',
      eff: '2026-04-15',
      exp: '2026-12-31',
    });
    expect(filled.discount).toBe(5);
    expect(filled.discount_flat).toBe(50);
    expect(filled.miles).toBe(2015);
    expect(filled.transit_days).toBe(3);
    expect(filled.eff).toBe('2026-04-15');
    expect(filled.exp).toBe('2026-12-31');
  });

});

describe('validateRateForm', () => {
  const base = buildInitialRateForm();

  it('accepts a fully-populated new rate', () => {
    const result = validateRateForm(
      { ...base, lane: 'L1', carrier: 'XPO', originCity: 'Chicago', destCity: 'Dallas' },
      { isNew: true, existingLanes: [] },
    );
    expect(result.ok).toBe(true);
  });

  it('auto-generates the lane id when it is empty but cities + carrier are set', () => {
    const result = validateRateForm(
      { ...base, lane: '', carrier: 'XPO Logistics', originCity: 'Chicago', destCity: 'Dallas', mode: 'LTL', serviceLevel: 'Standard' },
      { isNew: true, existingLanes: [] },
    );
    expect(result.ok).toBe(true);
    expect(result.patchedForm?.lane).toMatch(/^XL-CHI-DAL-LTL-STA-\d{8}$/);
  });

  it('rejects an empty lane when cities are also missing', () => {
    const result = validateRateForm(
      { ...base, lane: '' },
      { isNew: true },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Lane ID is required/);
  });

  it('rejects a duplicate lane on create (and not on edit)', () => {
    const lanes = ['L1'];
    const create = validateRateForm(
      { ...base, lane: 'L1', carrier: 'X', originCity: 'A', destCity: 'B' },
      { isNew: true, existingLanes: lanes },
    );
    expect(create.ok).toBe(false);
    expect(create.error).toMatch(/Duplicate Lane ID/);

    const edit = validateRateForm(
      { ...base, lane: 'L1', carrier: 'X', originCity: 'A', destCity: 'B' },
      { isNew: false, existingLanes: lanes },
    );
    expect(edit.ok).toBe(true);
  });

  it('rejects when origin / dest / carrier are missing', () => {
    const noCarrier = validateRateForm(
      { ...base, lane: 'L1', carrier: '', originCity: 'A', destCity: 'B' },
      { isNew: true },
    );
    expect(noCarrier.ok).toBe(false);
    expect(noCarrier.error).toMatch(/Origin, Destination, and Carrier/);
  });
});

describe('applyRateFieldChange', () => {
  const base = buildInitialRateForm();

  it('returns an unchanged-but-new object for non-mode changes', () => {
    const next = applyRateFieldChange(base, 'lane', 'L1');
    expect(next.lane).toBe('L1');
    expect(next).not.toBe(base);
    // Should not have triggered the mode-flip side effects.
    expect(next.equipment).toBe(base.equipment);
  });

  it('switching to LTL enables CzarLite', () => {
    const next = applyRateFieldChange({ ...base, mode: 'TL' }, 'mode', 'LTL');
    expect(next.mode).toBe('LTL');
    expect(next.czarlite).toBe(true);
    expect(next.equipment).toBe('LTL');
  });

  it('does not overwrite a pinned equipment value when mode flips', () => {
    const pinned = { ...base, equipment: 'Step Deck' };
    const next = applyRateFieldChange(pinned, 'mode', 'LTL');
    expect(next.equipment).toBe('Step Deck');
  });
});

describe('mutations', () => {
  it('saveRate routes new rates through upsert', async () => {
    (DbApi.upsert as jest.Mock).mockResolvedValue({ ok: true });
    await saveRate(null, { lane: 'L1' }, true);
    expect(DbApi.upsert).toHaveBeenCalledWith('rates', { lane: 'L1' });
    expect(DbApi.patch).not.toHaveBeenCalled();
  });

  it('saveRate routes edits through patch', async () => {
    (DbApi.patch as jest.Mock).mockResolvedValue({ ok: true });
    await saveRate('R1', { rate: '$3.00' }, false);
    expect(DbApi.patch).toHaveBeenCalledWith('rates', 'R1', { rate: '$3.00' });
    expect(DbApi.upsert).not.toHaveBeenCalled();
  });

  it('saveRate falls back to upsert when id is missing on an edit', async () => {
    (DbApi.upsert as jest.Mock).mockResolvedValue({ ok: true });
    await saveRate(undefined, { lane: 'L1' }, false);
    expect(DbApi.upsert).toHaveBeenCalledWith('rates', { lane: 'L1' });
  });

  it('deleteRate requires an id', async () => {
    await expect(deleteRate('')).rejects.toThrow(/id is required/);
    expect(DbApi.remove).not.toHaveBeenCalled();
  });

  it('deleteRate calls DbApi.remove', async () => {
    (DbApi.remove as jest.Mock).mockResolvedValue({ ok: true });
    await deleteRate('R1');
    expect(DbApi.remove).toHaveBeenCalledWith('rates', 'R1');
  });

  it('duplicateRate strips id / timestamps and tags lane with (COPY)', async () => {
    (DbApi.upsert as jest.Mock).mockResolvedValue({ ok: true });
    await duplicateRate({
      id: 'R1',
      created_at: '2026-04-01',
      updated_at: '2026-04-15',
      lane: 'CHI-LAX-001',
      carrier: 'XPO',
      rate: '$2.50',
    });
    expect(DbApi.upsert).toHaveBeenCalledTimes(1);
    const arg = (DbApi.upsert as jest.Mock).mock.calls[0][1];
    expect(arg.id).toBeUndefined();
    expect(arg.created_at).toBeUndefined();
    expect(arg.updated_at).toBeUndefined();
    expect(arg.lane).toBe('CHI-LAX-001 (COPY)');
    expect(arg.carrier).toBe('XPO');
    expect(arg.rate).toBe('$2.50');
  });

  it('duplicateRate falls back to NEW-LANE when source has no lane', async () => {
    (DbApi.upsert as jest.Mock).mockResolvedValue({ ok: true });
    await duplicateRate({ id: 'R1', carrier: 'XPO' });
    const arg = (DbApi.upsert as jest.Mock).mock.calls[0][1];
    expect(arg.lane).toBe('NEW-LANE (COPY)');
  });

  it('duplicateRate rejects non-objects', async () => {
    await expect(duplicateRate(null)).rejects.toThrow(/rate object is required/);
  });
});
