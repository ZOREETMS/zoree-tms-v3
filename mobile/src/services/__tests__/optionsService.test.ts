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

  describe('QA bug #113 — OMS customer master merge', () => {
    it('merges OMS customers with order-derived names, deduped', () => {
      const orders = [
        { customer: 'Acme Corp' },
        { customer: 'Globex' },
      ];
      const customers = [
        { id: 1, name: 'Acme Corp', active: true },
        { id: 2, name: 'Initech', active: true },
        { id: 3, name: 'Stark Industries', active: true },
      ];
      const opts = customerOptions(orders, customers);
      expect(opts.map((o) => o.value)).toEqual([
        'Acme Corp',
        'Globex',
        'Initech',
        'Stark Industries',
      ]);
    });

    it('falls back gracefully when only orders are provided (back-compat)', () => {
      const orders = [{ customer: 'Acme Corp' }];
      expect(customerOptions(orders)).toEqual([
        { value: 'Acme Corp', label: 'Acme Corp' },
      ]);
    });

    it('uses the OMS master casing as the canonical display name', () => {
      const orders = [{ customer: 'acme  corp' }];
      const customers = [{ id: 1, name: 'ACME Corp', active: true }];
      const opts = customerOptions(orders, customers);
      expect(opts).toEqual([{ value: 'ACME Corp', label: 'ACME Corp' }]);
    });

    it('skips OMS rows with blank names without poisoning the result', () => {
      const orders = [{ customer: 'Acme Corp' }];
      const customers = [
        { id: 1, name: '', active: true },
        { id: 2, name: '   ', active: true },
        { id: 3, name: null, active: true },
        { id: 4, name: 'Globex', active: true },
      ];
      const opts = customerOptions(orders, customers);
      expect(opts.map((o) => o.value)).toEqual(['Acme Corp', 'Globex']);
    });
  });

  describe('QA P210 — invisible-character dedup', () => {
    it('treats names differing only by zero-width chars as duplicates', () => {
      const orders = [
        { customer: 'AT&T' },
        { customer: 'AT​&T' },
        { customer: 'AT‍&T' },
        { customer: 'AT‌&T' },
        { customer: '﻿AT&T' },
      ];
      const opts = customerOptions(orders);
      expect(opts).toEqual([{ value: 'AT&T', label: 'AT&T' }]);
    });

    it('folds Unicode dash variants to a single dedup key', () => {
      const orders = [
        { customer: 'Coca-Cola' },
        { customer: 'Coca‐Cola' },
        { customer: 'Coca‑Cola' },
        { customer: 'Coca–Cola' },
        { customer: 'Coca—Cola' },
      ];
      const opts = customerOptions(orders);
      expect(opts).toEqual([{ value: 'Coca-Cola', label: 'Coca-Cola' }]);
    });

    it('still keeps genuinely distinct customers distinct', () => {
      const opts = customerOptions([
        { customer: 'Acme Corp' },
        { customer: 'Acme Corporation' },
      ]);
      expect(opts.map((o) => o.value)).toEqual([
        'Acme Corp',
        'Acme Corporation',
      ]);
    });
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
    expect(opts).toContainEqual(
      expect.objectContaining({
        value: 'Chicago, IL 60601',
        label: 'Chicago DC',
        sublabel: 'Chicago, IL 60601',
      }),
    );
    expect(opts).toContainEqual(
      expect.objectContaining({
        value: 'Dallas, TX 75201',
        label: 'Dallas, TX 75201',
      }),
    );
  });

  it('attaches meta with name/city/state/zip for picker auto-populate', () => {
    const locations = [
      { name: 'Chicago DC', city: 'Chicago', state: 'IL', zip: '60601' },
    ];
    const opts = locationOptions(locations);
    expect(opts).toHaveLength(1);
    expect(opts[0].meta).toEqual({
      name: 'Chicago DC',
      city: 'Chicago',
      state: 'IL',
      zip: '60601',
    });
  });

  it('upper-cases the state code in meta even if the source row was lowercase', () => {
    const opts = locationOptions([
      { name: 'Chicago DC', city: 'Chicago', state: 'il', zip: '60601' },
    ]);
    expect(opts[0].meta?.state).toBe('IL');
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

  it('skips locations that have no name, city, or state', () => {
    const locations = [
      { name: '', city: '', state: '', zip: '' },
      { name: 'Empty', city: '', state: '', zip: '' },
      { name: 'Just zip', zip: '10001' },
    ];
    const opts = locationOptions(locations);
    expect(opts).toHaveLength(2);
    expect(opts.map((o) => o.label)).toEqual(
      expect.arrayContaining(['Empty', 'Just zip']),
    );
  });

  it('accepts postal_code as a fallback for zip', () => {
    const locations = [
      { name: 'Toronto', city: 'Toronto', state: 'ON', postal_code: 'M5H' },
    ];
    const opts = locationOptions(locations);
    expect(opts[0].value).toBe('Toronto, ON M5H');
    expect(opts[0].meta?.zip).toBe('M5H');
  });

  // QA P211 (2026-05-11) regression coverage: the mobile Planning
  // Origin / Destination dropdowns must surface the union of the TMS
  // `locations` table AND the OMS `oms_locations` master, matching what
  // the web's LocationSearchDropdown returns. Without the merge,
  // OMS-only warehouses (e.g. "College Park") were missing from mobile.
  describe('QA P211 — OMS locations master merge', () => {
    it('merges OMS locations with TMS locations, deduped by composed value', () => {
      const tms = [
        { name: 'Chicago DC', city: 'Chicago', state: 'IL', zip: '60601' },
      ];
      const oms = [
        { name: 'Chicago DC', city: 'Chicago', state: 'IL', zip: '60601' },
        { name: 'College Park', city: 'College Park', state: 'MD', zip: '20740' },
      ];
      const opts = locationOptions(tms, oms);
      const values = opts.map((o) => o.value);
      expect(values).toContain('Chicago, IL 60601');
      expect(values).toContain('College Park, MD 20740');
      expect(values.filter((v) => v === 'Chicago, IL 60601')).toHaveLength(1);
    });

    it('keeps a name-only OMS row (no city/state) in the dropdown', () => {
      const opts = locationOptions(null, [{ name: 'College Park' }]);
      expect(opts).toEqual([
        expect.objectContaining({ value: 'College Park', label: 'College Park' }),
      ]);
    });

    it('falls back to TMS-only when the OMS argument is missing (back-compat)', () => {
      const opts = locationOptions([
        { name: 'Dallas DC', city: 'Dallas', state: 'TX', zip: '75201' },
      ]);
      expect(opts).toEqual([
        expect.objectContaining({ value: 'Dallas, TX 75201', label: 'Dallas DC' }),
      ]);
    });

    it('returns [] when both arguments are empty / nullish', () => {
      expect(locationOptions(null, null)).toEqual([]);
      expect(locationOptions(undefined, undefined)).toEqual([]);
      expect(locationOptions([], [])).toEqual([]);
    });
  });
});
