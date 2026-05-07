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

  // QA bug #113 regression coverage: customerOptions must merge the
  // OMS customer master with order-derived customers so the dropdown
  // surfaces every active customer rather than just the few seen on
  // existing orders.
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
      // All four distinct names appear; Acme Corp is deduped to one row.
      expect(opts.map((o) => o.value)).toEqual([
        'Acme Corp',
        'Globex',
        'Initech',
        'Stark Industries',
      ]);
    });

    it('falls back gracefully when only orders are provided (back-compat)', () => {
      const orders = [{ customer: 'Acme Corp' }];
      // Single-arg call — preserves the legacy contract for callers
      // that haven't been updated to pass the customer master yet.
      expect(customerOptions(orders)).toEqual([
        { value: 'Acme Corp', label: 'Acme Corp' },
      ]);
    });

    it('uses the OMS master casing as the canonical display name', () => {
      // First-seen casing wins — and the OMS source is processed
      // first, so even if a legacy order row spelled the customer
      // differently, the master row's casing is what users see.
      const orders = [{ customer: 'acme  corp' }]; // sloppy whitespace + casing
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
    // QA bug #115: each option now also carries a `meta` payload
    // with the source row's structured fields so the form can
    // auto-populate City / State / ZIP on selection. We assert the
    // user-visible fields with toMatchObject so this test isn't
    // brittle to the meta shape — meta itself is verified below.
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

  // QA bug #115 regression: location options must carry structured
  // meta so the picker can hydrate City / State / ZIP on selection.
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
    // The composeAddress / form code always upper-cases for display;
    // verify locationOptions normalises in meta too so the auto-
    // populated form input is consistent.
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
    // Stale test fix: this case was originally expected to return
    // length 0, but QA bug #105 (already fixed in the source) widened
    // the inclusion rule to "at least one of name / city / state" so
    // warehouse rows with only a label (e.g. "College Park") still
    // surface in the dropdown. The test is updated to match: rows
    // with a name OR a city/state/zip are kept; only fully-empty rows
    // are skipped.
    const locations = [
      { name: '', city: '', state: '', zip: '' }, // fully blank — skipped
      { name: 'Empty', city: '', state: '', zip: '' }, // name-only — kept
      { name: 'Just zip', zip: '10001' }, // name + zip — kept
    ];
    const opts = locationOptions(locations);
    expect(opts).toHaveLength(2);
    expect(opts.map((o) => o.label)).toEqual(
      // Sorted alphabetically by label.
      expect.arrayContaining(['Empty', 'Just zip']),
    );
  });

  it('accepts postal_code as a fallback for zip', () => {
    const locations = [
      { name: 'Toronto', city: 'Toronto', state: 'ON', postal_code: 'M5H' },
    ];
    const opts = locationOptions(locations);
    expect(opts[0].value).toBe('Toronto, ON M5H');
    // The meta carries the resolved zip value too so the picker can
    // hydrate the form's ZIP field even for postal_code-sourced rows.
    expect(opts[0].meta?.zip).toBe('M5H');
  });
});
