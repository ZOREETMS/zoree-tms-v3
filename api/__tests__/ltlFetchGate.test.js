// Regression tests for QA #136 — "LTL rates not displayed for orders
// above 15,000 lbs planned as LTL".
//
// Run with: node --test api/__tests__/ltlFetchGate.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldFetchLtl } = require('../services/ltlFetchGate');

const LTL_MAX = 20000; // mirrors equipment_types.LTL.max_weight

test('default mixed-mode lane fetches LTL only when weight ≤ ceiling', () => {
  assert.equal(
    shouldFetchLtl({ wantsLtl: true, wantsTl: true, weight: 5000,  ltlMax: LTL_MAX }),
    true,
    'light lane → fetch LTL',
  );
  assert.equal(
    shouldFetchLtl({ wantsLtl: true, wantsTl: true, weight: 25000, ltlMax: LTL_MAX }),
    false,
    'heavy lane in mixed mode → skip LTL fetch (TL will cover)',
  );
  assert.equal(
    shouldFetchLtl({ wantsLtl: true, wantsTl: true, weight: LTL_MAX, ltlMax: LTL_MAX }),
    true,
    'exactly at ceiling → still fetch (≤ comparison)',
  );
});

test('QA #136 — explicit LTL-only fetches even past the ceiling', () => {
  // The bug: a 16,000 lb shipment with the user's planning mode set
  // explicitly to LTL was returning only TL quotes. The gate now lets
  // the LTL fetch through; the over-ceiling quotes get marked
  // infeasible downstream so the user sees them but is warned.
  assert.equal(
    shouldFetchLtl({ wantsLtl: true, wantsTl: false, weight: 16000, ltlMax: LTL_MAX }),
    true,
  );
  assert.equal(
    shouldFetchLtl({ wantsLtl: true, wantsTl: false, weight: 50000, ltlMax: LTL_MAX }),
    true,
    'no upper bound when user picked LTL — they get to see the quote',
  );
});

test('TL-only lanes never fetch LTL', () => {
  assert.equal(
    shouldFetchLtl({ wantsLtl: false, wantsTl: true, weight: 5000,  ltlMax: LTL_MAX }),
    false,
  );
  assert.equal(
    shouldFetchLtl({ wantsLtl: false, wantsTl: true, weight: 25000, ltlMax: LTL_MAX }),
    false,
  );
});

test('Empty mode set never fetches LTL (defensive)', () => {
  assert.equal(
    shouldFetchLtl({ wantsLtl: false, wantsTl: false, weight: 5000, ltlMax: LTL_MAX }),
    false,
  );
});

test('Weight coercion handles string inputs', () => {
  // The lane object pulls totalWeight from a sum that JavaScript could
  // theoretically coerce; the gate must not blow up on a numeric
  // string from upstream.
  assert.equal(
    shouldFetchLtl({ wantsLtl: true, wantsTl: true, weight: '5000', ltlMax: LTL_MAX }),
    true,
  );
  assert.equal(
    shouldFetchLtl({ wantsLtl: true, wantsTl: true, weight: '25000', ltlMax: LTL_MAX }),
    false,
  );
});

test('Documentation truth table', () => {
  // Captures the full 4-cell decision matrix once, as a contract.
  const cases = [
    // [wantsLtl, wantsTl, weight, expected]
    [true,  true,  10000, true],   // default mixed, light → fetch
    [true,  true,  25000, false],  // default mixed, heavy → skip
    [true,  false, 10000, true],   // explicit LTL, light → fetch
    [true,  false, 25000, true],   // explicit LTL, heavy → fetch (the bug fix)
    [false, true,  10000, false],  // explicit TL, light → no LTL
    [false, true,  25000, false],  // explicit TL, heavy → no LTL
    [false, false, 10000, false],  // empty modes → no LTL
  ];
  for (const [wantsLtl, wantsTl, weight, expected] of cases) {
    assert.equal(
      shouldFetchLtl({ wantsLtl, wantsTl, weight, ltlMax: LTL_MAX }),
      expected,
      `wantsLtl=${wantsLtl} wantsTl=${wantsTl} weight=${weight} → ${expected}`,
    );
  }
});
