/**
 * Unit tests for mobile/src/services/locationsService.ts.
 *
 * Pure helpers (locationDisplayValue, validateNewLocation) plus one
 * thin async wrapper (createLocation) that we mock the API client for.
 * The QA bug #114 contract is verified end-to-end so a future
 * regression in the inline create-location flow shows up here first.
 */

import {
  createLocation,
  locationDisplayValue,
  validateNewLocation,
} from '../locationsService';
import { DbApi } from '../../shared/api';

jest.mock('../../shared/api', () => ({
  DbApi: {
    upsert: jest.fn(),
  },
}));

beforeEach(() => {
  (DbApi.upsert as jest.Mock).mockReset();
});

describe('locationDisplayValue', () => {
  it('formats City, ST ZIP when all three are present', () => {
    expect(
      locationDisplayValue({ city: 'Dallas', state: 'TX', zip: '75201' }),
    ).toBe('Dallas, TX 75201');
  });

  it('upper-cases the state code', () => {
    expect(
      locationDisplayValue({ city: 'Dallas', state: 'tx', zip: '75201' }),
    ).toBe('Dallas, TX 75201');
  });

  it('drops the trailing ZIP when missing', () => {
    expect(locationDisplayValue({ city: 'Dallas', state: 'TX' })).toBe(
      'Dallas, TX',
    );
  });

  it('handles a city-only row gracefully', () => {
    expect(locationDisplayValue({ city: 'Dallas' })).toBe('Dallas');
  });

  it('handles a state-only row', () => {
    expect(locationDisplayValue({ state: 'TX' })).toBe('TX');
  });

  it('returns empty string when nothing is supplied', () => {
    expect(locationDisplayValue({})).toBe('');
    expect(locationDisplayValue({ city: '', state: '', zip: '' })).toBe('');
  });
});

describe('validateNewLocation', () => {
  it('accepts a name-only entry (matches the optionsService inclusion rule)', () => {
    // QA bug #105 / #115 alignment: a row with only a name is a
    // legitimate location row, so create-location should accept it
    // for parity with the picker's display rule.
    expect(validateNewLocation({ name: 'Toronto DC' })).toEqual([]);
  });

  it('accepts a city-only entry', () => {
    expect(validateNewLocation({ city: 'Toronto' })).toEqual([]);
  });

  it('rejects a fully blank entry', () => {
    const errs = validateNewLocation({});
    expect(errs).toEqual(
      expect.arrayContaining([expect.stringMatching(/Name or City/)]),
    );
  });

  it('rejects a state code that is not 2 letters', () => {
    expect(validateNewLocation({ city: 'X', state: 'TXX' })).toEqual(
      expect.arrayContaining([expect.stringMatching(/2-letter/)]),
    );
  });

  it('accepts a 5-digit ZIP', () => {
    expect(validateNewLocation({ city: 'X', zip: '75201' })).toEqual([]);
  });

  it('accepts ZIP+4', () => {
    expect(validateNewLocation({ city: 'X', zip: '75201-1234' })).toEqual([]);
  });

  it('rejects a malformed ZIP', () => {
    expect(validateNewLocation({ city: 'X', zip: 'ABCDE' })).toEqual(
      expect.arrayContaining([expect.stringMatching(/ZIP/)]),
    );
  });
});

describe('createLocation (QA bug #114)', () => {
  it('throws a validation error before round-tripping', async () => {
    await expect(createLocation({})).rejects.toThrow(/Name or City/);
    expect(DbApi.upsert).not.toHaveBeenCalled();
  });

  it('persists the trimmed / upper-cased payload to public.locations', async () => {
    (DbApi.upsert as jest.Mock).mockResolvedValue({
      id: 99,
      name: 'Dallas DC',
      city: 'Dallas',
      state: 'TX',
      zip: '75201',
    });
    const created = await createLocation({
      name: '  Dallas DC  ',
      city: 'Dallas',
      state: 'tx', // lowercased to verify the upper-case contract
      zip: '75201',
    });
    expect(DbApi.upsert).toHaveBeenCalledTimes(1);
    expect(DbApi.upsert).toHaveBeenCalledWith('locations', {
      name: 'Dallas DC',
      city: 'Dallas',
      state: 'TX', // upper-cased on persist
      zip: '75201',
    });
    expect(created.id).toBe(99);
    expect(created.state).toBe('TX');
  });

  it('normalises the {row: ...} response shape some upserts emit', async () => {
    (DbApi.upsert as jest.Mock).mockResolvedValue({
      row: { id: 7, name: 'Wrapped' },
    });
    const created = await createLocation({ name: 'Wrapped' });
    expect(created.id).toBe(7);
  });

  it('normalises the [row] array response shape', async () => {
    (DbApi.upsert as jest.Mock).mockResolvedValue([{ id: 5, name: 'Arr' }]);
    const created = await createLocation({ name: 'Arr' });
    expect(created.id).toBe(5);
  });

  it('falls back to the input payload when the server returns nothing', async () => {
    (DbApi.upsert as jest.Mock).mockResolvedValue(null);
    const created = await createLocation({ name: 'Echo' });
    // Defensive — the screen-level UX still wants something to dispatch
    // back to the form even on a no-content response.
    expect(created.name).toBe('Echo');
  });
});
