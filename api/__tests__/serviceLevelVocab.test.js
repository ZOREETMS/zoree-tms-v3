// Regression tests for TMS bugs #33 + #66.
//
// Run with: node --test api/__tests__/serviceLevelVocab.test.js
//
// Pure-function tests — no DB, no network. The vocabulary normalizer is
// the single source of truth that prevents OMS Priority="Expedite" from
// landing in TMS as the unrecognized value "Expedite" (instead of the
// canonical "Expedited").

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeServiceLevel,
  serviceLevelShortCode,
  CANONICAL,
  ALIASES,
} = require('../services/serviceLevelVocab');

test('normalizeServiceLevel maps OMS Priority "Expedite" → TMS "Expedited" (bug #66)', () => {
  assert.equal(normalizeServiceLevel('Expedite'), 'Expedited');
});

test('normalizeServiceLevel collapses lowercase / whitespace variants', () => {
  assert.equal(normalizeServiceLevel('  expedite  '), 'Expedited');
  assert.equal(normalizeServiceLevel('EXPEDITE'),     'Expedited');
  assert.equal(normalizeServiceLevel('expedited'),    'Expedited');
  assert.equal(normalizeServiceLevel('Express'),      'Expedited');
  assert.equal(normalizeServiceLevel('EXP'),          'Expedited');
});

test('normalizeServiceLevel maps OMS "Critical" → TMS "Time-Critical"', () => {
  assert.equal(normalizeServiceLevel('Critical'),       'Time-Critical');
  assert.equal(normalizeServiceLevel('time-critical'),  'Time-Critical');
  assert.equal(normalizeServiceLevel('TIME CRITICAL'),  'Time-Critical');
});

test('normalizeServiceLevel passes Standard / Economy / Guaranteed through', () => {
  assert.equal(normalizeServiceLevel('Standard'),   'Standard');
  assert.equal(normalizeServiceLevel('STD'),        'Standard');
  assert.equal(normalizeServiceLevel('Economy'),    'Economy');
  assert.equal(normalizeServiceLevel('Guaranteed'), 'Guaranteed');
  assert.equal(normalizeServiceLevel('GTD'),        'Guaranteed');
});

test('normalizeServiceLevel preserves White Glove punctuation', () => {
  assert.equal(normalizeServiceLevel('white glove'),  'White Glove');
  assert.equal(normalizeServiceLevel('White-Glove'),  'White Glove');
  assert.equal(normalizeServiceLevel('WG'),           'White Glove');
});

test('normalizeServiceLevel returns null for empty / nullish inputs', () => {
  assert.equal(normalizeServiceLevel(null),      null);
  assert.equal(normalizeServiceLevel(undefined), null);
  assert.equal(normalizeServiceLevel(''),        null);
  assert.equal(normalizeServiceLevel('   '),     null);
});

test('normalizeServiceLevel title-cases unknown labels (defense against future schema)', () => {
  // A label we don't know about shouldn't be silently dropped — the
  // ingest path still writes it to service_level, just normalised.
  assert.equal(normalizeServiceLevel('next-day-air'), 'Next-day-air');
});

test('serviceLevelShortCode returns the badge code', () => {
  assert.equal(serviceLevelShortCode('Expedited'),     'EXP');
  assert.equal(serviceLevelShortCode('Expedite'),      'EXP');
  assert.equal(serviceLevelShortCode('Standard'),      'STD');
  assert.equal(serviceLevelShortCode('Economy'),       'ECON');
  assert.equal(serviceLevelShortCode('Time-Critical'), 'CRIT');
  assert.equal(serviceLevelShortCode('White Glove'),   'WG');
  assert.equal(serviceLevelShortCode(''),              '');
  assert.equal(serviceLevelShortCode(null),            '');
});

test('CANONICAL list matches the TMS UI dropdown values', () => {
  // Documented contract — keep in lock-step with NewOrderModal.jsx /
  // OrderDetailModal.jsx / TenderAcceptModal.jsx. If you change one,
  // change them all.
  assert.deepEqual(CANONICAL, [
    'Standard',
    'Guaranteed',
    'Expedited',
    'Economy',
    'White Glove',
    'Time-Critical',
  ]);
});

test('Every canonical value normalises to itself (round-trip)', () => {
  for (const v of CANONICAL) {
    assert.equal(normalizeServiceLevel(v), v, `Round-trip failed for ${v}`);
  }
});

test('Every alias key normalises to a canonical value', () => {
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    assert.ok(
      CANONICAL.includes(canonical),
      `Alias ${alias} → ${canonical} (not in CANONICAL list)`,
    );
  }
});
