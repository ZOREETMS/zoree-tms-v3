/**
 * Unit tests for planningParametersService.ts +
 * dockLoadingDurationsService.ts.
 *
 * DbApi is mocked.
 */

import {
  fetchParameters,
  isFeatureEnabled,
  updateParameter,
} from '../planningParametersService';
import {
  DURATION_OPTIONS,
  fetchDurations,
  lookupDuration,
  updateDuration,
  validateDurationPatch,
} from '../dockLoadingDurationsService';
import { DbApi } from '../../lib/api';

jest.mock('../../lib/api', () => ({
  DbApi: {
    planningParameters: jest.fn(),
    dockLoadingDurations: jest.fn(),
    patch: jest.fn(),
  },
}));

describe('planningParametersService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetchParameters returns rows from the API', async () => {
    (DbApi.planningParameters as jest.Mock).mockResolvedValue([
      { id: 'p1', key: 'consolidation', label: 'Consolidation', enabled: true },
    ]);
    const rows = await fetchParameters();
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('consolidation');
  });

  it('fetchParameters returns [] on error or non-array', async () => {
    (DbApi.planningParameters as jest.Mock).mockRejectedValue(new Error('500'));
    expect(await fetchParameters()).toEqual([]);
    (DbApi.planningParameters as jest.Mock).mockResolvedValue(null);
    expect(await fetchParameters()).toEqual([]);
  });

  it('updateParameter PATCHes with enabled + updated_at', async () => {
    (DbApi.patch as jest.Mock).mockResolvedValue({ ok: true });
    await updateParameter('p1', true);
    expect(DbApi.patch).toHaveBeenCalledWith(
      'planning_parameters',
      'p1',
      expect.objectContaining({ enabled: true }),
    );
    const payload = (DbApi.patch as jest.Mock).mock.calls[0][2];
    expect(typeof payload.updated_at).toBe('string');
    expect(payload.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('updateParameter rejects when id is missing', async () => {
    await expect(updateParameter('', true)).rejects.toThrow(/id is required/);
    expect(DbApi.patch).not.toHaveBeenCalled();
  });

  it('isFeatureEnabled returns the flag, false for missing keys', () => {
    const params = [
      { id: 'p1', key: 'consolidation', label: 'X', enabled: true },
      { id: 'p2', key: 'multistop', label: 'Y', enabled: false },
    ];
    expect(isFeatureEnabled(params, 'consolidation')).toBe(true);
    expect(isFeatureEnabled(params, 'multistop')).toBe(false);
    expect(isFeatureEnabled(params, 'nope')).toBe(false);
    expect(isFeatureEnabled(null, 'consolidation')).toBe(false);
    expect(isFeatureEnabled(undefined, 'consolidation')).toBe(false);
  });
});

describe('dockLoadingDurationsService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('exposes the canonical duration options', () => {
    expect(DURATION_OPTIONS).toEqual(expect.arrayContaining([30, 60, 120, 240]));
  });

  it('fetchDurations returns rows or [] on error', async () => {
    (DbApi.dockLoadingDurations as jest.Mock).mockResolvedValue([
      { mode: 'TL', duration_minutes: 120, enabled: true },
    ]);
    const rows = await fetchDurations();
    expect(rows).toHaveLength(1);
    (DbApi.dockLoadingDurations as jest.Mock).mockRejectedValue(new Error('500'));
    expect(await fetchDurations()).toEqual([]);
  });

  describe('validateDurationPatch', () => {
    it('accepts in-range minutes', () => {
      expect(validateDurationPatch({ duration_minutes: 1 }).ok).toBe(true);
      expect(validateDurationPatch({ duration_minutes: 600 }).ok).toBe(true);
    });

    it('rejects out-of-range minutes', () => {
      expect(validateDurationPatch({ duration_minutes: 0 }).ok).toBe(false);
      expect(validateDurationPatch({ duration_minutes: -10 }).ok).toBe(false);
      expect(validateDurationPatch({ duration_minutes: 700 }).ok).toBe(false);
      expect(validateDurationPatch({ duration_minutes: NaN }).ok).toBe(false);
    });

    it('passes when minutes is omitted (enabled-only patch)', () => {
      expect(validateDurationPatch({ enabled: false }).ok).toBe(true);
      expect(validateDurationPatch({}).ok).toBe(true);
    });
  });

  describe('updateDuration', () => {
    it('rejects when mode missing or duration invalid', async () => {
      await expect(updateDuration('', { duration_minutes: 60 })).rejects.toThrow(/mode is required/);
      await expect(updateDuration('TL', { duration_minutes: 999 })).rejects.toThrow(/1 and 600/);
      expect(DbApi.patch).not.toHaveBeenCalled();
    });

    it('PATCHes with normalized mode + updated_at', async () => {
      (DbApi.patch as jest.Mock).mockResolvedValue({ ok: true });
      await updateDuration(' tl ', { duration_minutes: 90 });
      expect(DbApi.patch).toHaveBeenCalledWith(
        'dock_loading_durations',
        'TL',
        expect.objectContaining({ duration_minutes: 90 }),
      );
      const payload = (DbApi.patch as jest.Mock).mock.calls[0][2];
      expect(payload.updated_at).toMatch(/^\d{4}-/);
    });

    it('PATCHes enabled-only changes', async () => {
      (DbApi.patch as jest.Mock).mockResolvedValue({ ok: true });
      await updateDuration('TL', { enabled: false });
      expect(DbApi.patch).toHaveBeenCalledWith(
        'dock_loading_durations',
        'TL',
        expect.objectContaining({ enabled: false }),
      );
    });
  });

  describe('lookupDuration', () => {
    const rows = [
      { mode: 'TL', duration_minutes: 120, enabled: true },
      { mode: 'LTL', duration_minutes: 60, enabled: true },
      { mode: 'PARCEL', duration_minutes: 15, enabled: false },
    ];

    it('returns the row value when enabled', () => {
      expect(lookupDuration(rows, 'TL')).toBe(120);
      expect(lookupDuration(rows, 'ltl')).toBe(60); // case-insensitive
    });

    it('falls back to default when row is disabled', () => {
      expect(lookupDuration(rows, 'PARCEL')).toBe(120); // default
      expect(lookupDuration(rows, 'PARCEL', 30)).toBe(30); // explicit default
    });

    it('falls back to default when row is missing', () => {
      expect(lookupDuration(rows, 'AIR')).toBe(120);
      expect(lookupDuration([], 'TL')).toBe(120);
      expect(lookupDuration(null, 'TL', 90)).toBe(90);
    });

    it('falls back when duration_minutes is invalid', () => {
      expect(lookupDuration([{ mode: 'TL', duration_minutes: 0, enabled: true }], 'TL')).toBe(120);
      expect(lookupDuration([{ mode: 'TL', duration_minutes: NaN, enabled: true } as any], 'TL', 30)).toBe(30);
    });
  });
});
