/**
 * Unit tests for shared/utils/formatters.js.
 *
 * Pure functions; the only behaviour-bearing addition is
 * formatCurrencyFull (QA bug #128). The compact formatCurrency
 * variant is also covered to lock down the contract that KPI tiles
 * rely on, so a future "let's just unify these" refactor doesn't
 * accidentally change the dashboard rendering.
 */

import { formatCurrency, formatCurrencyFull } from '../formatters';

describe('formatCurrency (compact KPI display)', () => {
  it('abbreviates millions to one decimal', () => {
    expect(formatCurrency(2_400_000)).toBe('$2.4M');
  });

  it('rounds thousands to the nearest integer K', () => {
    // This is the exact mode that produced QA bug #128 on the
    // shipment list - 6961 / 1000 = 6.961, rounded to 7 → "$7K".
    // Not wrong for KPI tiles, just wrong for line-item display.
    expect(formatCurrency(6_961)).toBe('$7K');
    expect(formatCurrency(284_000)).toBe('$284K');
  });

  it('formats sub-thousand values without abbreviation', () => {
    expect(formatCurrency(99)).toBe('$99');
    expect(formatCurrency(0)).toBe('$0');
  });
});

describe('formatCurrencyFull (line-item / shipment cost display — QA bug #128)', () => {
  // Anchor: this formatter must mirror the web TMS's formatUSD
  // (frontend/src/utils/shipmentCost.js) byte-for-byte. Both call
  // Number#toLocaleString() with no options. The tests below pin the
  // observable contract — anyone tempted to "improve" by adding
  // fraction-digit options will see these tests change too, which
  // is the alarm we want.

  it('renders 6961 as $6,961 to match the web TMS exactly', () => {
    // The exact regression case from the QA report: web showed
    // $6,961, mobile showed $7K. After the fix, both surfaces
    // render the same value side-by-side.
    expect(formatCurrencyFull(6_961)).toBe('$6,961');
  });

  it('uses a thousands separator on large amounts', () => {
    expect(formatCurrencyFull(2_400_000)).toBe('$2,400,000');
  });

  it('formats zero as $0 (no NaN leak)', () => {
    expect(formatCurrencyFull(0)).toBe('$0');
  });

  it('coerces non-number inputs to $0 instead of $NaN', () => {
    // Defensive — a partially-loaded shipment row can have
    // total_cost === undefined or a non-numeric string. The
    // formatter must never leak "$NaN" into the UI.
    expect(formatCurrencyFull(undefined)).toBe('$0');
    expect(formatCurrencyFull(null)).toBe('$0');
    expect(formatCurrencyFull(NaN)).toBe('$0');
    expect(formatCurrencyFull('not-a-number')).toBe('$0');
  });

  it('accepts numeric strings (parseable via Number())', () => {
    // total_cost columns sometimes arrive as strings from PostgREST
    // numeric/decimal types; the formatter should coerce cleanly.
    expect(formatCurrencyFull('6961')).toBe('$6,961');
  });
});
