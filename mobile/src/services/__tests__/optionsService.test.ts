/**
 * Unit tests for mobile/src/services/optionsService.ts.
 *
 * Pure functions, no network — keep these snappy. The DataContext rows
 * arrive in a few different shapes (camelCase from /api/orders, raw
 * snake_case from a Supabase fetch), so we cover both.
 */

import { customerOptions, locationOptions } from '../optionsService';

describe('customerOptions', () => {
  it('returns [] for non-array input', () => {
    expect(customerOptions(null)).toEqual([]);
    expect(customerOptions(undefined)).toEqual([]);
    expect(customerOptions({} as any)).toEqual([]);
  });

  it('extracts unique customer names sorted alphabetically', () => {
    const orders = [
      { id: 'A', customer: 'Acme Corp' },
      { id: 'B', customer: 'Globex' },
      { id: 'C', customer: 'Acme Corp' },
      { id: 'D', customer: 'Initech' },
    ];
    expect(customerOptions(orders)).toEqual([
      { value: 'Acme Corp', label: 'Acme Corp' },
      { value: 'Globex', label: 'Globex' },
      { value: 'Initech', label: 'Initech' },
    ]);
  });

  it('skips blank / whitespace-only customer names', () => {
    const orders = [
      { customer: 'Acme Corp' },
      { customer: '' },
      { customer: '   ' },
      { customer: null },
      { customer: undefined },
    ];
    expect(customerOptions(orders)).toEqual([
      { value: 'Acme Corp', label: 'Acme Corp' },
    ]);
  });
});

describe('locationOptions', () => {
  it('returns [] for non-array input', () => {
    expect(locationOptions(null)).toEqual([]);
    expect(locationOptions(undefined)).toEqual([]);
  });

  it('formats City, ST ZIP and uses name as label when present', () => {
    const locations = [
      { name: 'Chicago DC', city: 'Chicago', state: 'IL', zip: '60601' },
      { city: 'Dallas', state: 'TX', zip: '75201' },
    ];
    const opts = locationOptions(locations);
    expect(opts).toContainEqual({
      value: 'Chicago, IL 60601',
      label: 'Chicago DC',
      sublabel: 'Chicago, IL 60601',
    });
    expect(opts).toContainEqual({
      value: 'Dallas, TX 75201',
      label: 'Dallas, TX 75201',
    });
  });

  it('deduplicates options that share the same address', () => {
    const locations = [
      { name: 'Chicago DC', city: 'Chicago', state: 'IL', zip: '60601' },
      { name: 'Chicago Dock 2', city: 'Chicago', state: 'IL', zip: '60601' },
    ];
    const opts = locationOptions(locations);
    expect(opts).toHaveLength(1);
    expect(opts[0].value).toBe('Chicago, IL 60601');
  });

  it('skips locations with no usable city/state/zip', () => {
    const locations = [
      { name: 'Empty', city: '', state: '', zip: '' },
      { name: 'Just zip', zip: '10001' },
    ];
    expect(locationOptions(locations)).toHaveLength(0);
  });

  it('accepts postal_code as a fallback for zip', () => {
    const locations = [
      { name: 'Toronto', city: 'Toronto', state: 'ON', postal_code: 'M5H' },
    ];
    expect(locationOptions(locations)[0].value).toBe('Toronto, ON M5H');
  });
});
