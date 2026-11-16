'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { isRateCurrent, matchAllRates, matchRate } = require('../services/rateMatcher');

const ASOF = new Date('2026-09-09T12:00:00Z');
const base = (over = {}) => ({
  id: 1, carrier: 'XPO LOGISTICS', origin: 'Atlanta, GA', dest: 'New York, NY',
  mode: 'LTL', rate: '$18.00', unit: 'per cwt', status: 'Active',
  eff: '2026-09-01', exp: '2027-09-01', ...over,
});
const ctx = { originCity: 'ATLANTA, GA 30303', destCity: 'NEW YORK, NY 10001', asOf: ASOF };

test('a current active rate is usable', () => {
  assert.equal(isRateCurrent(base(), ASOF), true);
});

test('a non-active status is not usable, case-insensitively', () => {
  for (const status of ['Expired', 'expired', 'INACTIVE', 'Draft']) {
    assert.equal(isRateCurrent(base({ status }), ASOF), false, status);
  }
});

test('a rate past its exp date is not usable even while marked Active', () => {
  // The live defect: 8 of 133 Active rows were already past exp.
  assert.equal(isRateCurrent(base({ exp: '2026-07-07' }), ASOF), false);
});

test('a rate not yet effective is not usable', () => {
  assert.equal(isRateCurrent(base({ eff: '2026-12-01' }), ASOF), false);
});

test('missing eff/exp is treated as open-ended', () => {
  assert.equal(isRateCurrent(base({ eff: null, exp: null }), ASOF), true);
});

test('unparseable dates do not disqualify a rate', () => {
  assert.equal(isRateCurrent(base({ eff: 'not-a-date', exp: '' }), ASOF), true);
});

test('matchAllRates drops expired rows before matching', () => {
  const rows = [base({ id: 7, status: 'Expired', rate: '$3.25' }), base({ id: 200 })];
  const { rates } = matchAllRates(ctx, rows);
  assert.equal(rates.length, 1);
  assert.equal(rates[0].rate.id, 200, 'the Expired $3.25 placeholder must not match');
});

test('matchRate reports no-candidates when every rate is expired', () => {
  const out = matchRate(ctx, [base({ status: 'Expired' }), base({ id: 2, exp: '2026-01-01' })]);
  assert.equal(out.rate, null);
  assert.equal(out.reason, 'no-candidates');
});

test('matchAllRates reports no-candidates when every rate is expired', () => {
  const out = matchAllRates(ctx, [base({ status: 'Expired' })]);
  assert.deepEqual(out.rates, []);
  assert.equal(out.reason, 'no-candidates');
});
