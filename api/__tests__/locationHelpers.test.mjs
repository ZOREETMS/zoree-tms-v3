// QA #155 — locationFromOrderOrigin / locationFromOrderDest must hydrate
// City/State from explicit columns when the composed `origin`/`dest`
// string is missing or only carries a location name.
//
// These tests live in api/__tests__ (Node's built-in test runner) but
// import from the frontend src tree directly. Frontend now declares
// "type": "module" so Node treats those .js files as ESM.
//
// Run with: node --test api/__tests__/locationHelpers.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  locationFromOrderOrigin,
  locationFromOrderDest,
  locationFromShipmentOrigin,
  locationFromShipmentDest,
  parseAddressString,
} from '../../frontend/src/types/location.js';

// ── locationFromOrderOrigin ─────────────────────────────────────────

test('locationFromOrderOrigin parses a CITY, ST ZIP origin string', () => {
  const loc = locationFromOrderOrigin({ origin: 'CHICAGO, IL 60601', ship_from_name: 'Chicago DC' });
  assert.equal(loc.name,  'Chicago DC');
  assert.equal(loc.city,  'CHICAGO');
  assert.equal(loc.state, 'IL');
  assert.equal(loc.zip,   '60601');
});

test('QA #155 — falls back to ship_from_city / ship_from_state when origin string is empty', () => {
  // The repro: an order saved by the OMS with structured columns but
  // an empty `origin` string left the Edit modal blank.
  const loc = locationFromOrderOrigin({
    origin: '',
    ship_from_name:  'Atlanta DC',
    ship_from_city:  'Atlanta',
    ship_from_state: 'GA',
    origin_zip:      '30301',
  });
  assert.equal(loc.name,  'Atlanta DC');
  assert.equal(loc.city,  'Atlanta');
  assert.equal(loc.state, 'GA');
  assert.equal(loc.zip,   '30301');
});

test('QA #155 — also accepts camelCase aliases (shipFromCity / originCity)', () => {
  const loc = locationFromOrderOrigin({
    origin: '',
    shipFromCity:  'Dallas',
    shipFromState: 'TX',
    originZip:     '75201',
  });
  assert.equal(loc.city,  'Dallas');
  assert.equal(loc.state, 'TX');
  assert.equal(loc.zip,   '75201');
});

test('QA #155 — explicit columns win over the parsed string', () => {
  // If both are set, structured columns are the source of truth — the
  // composed string is a back-compat artifact.
  const loc = locationFromOrderOrigin({
    origin: 'WRONGCITY, ZZ 99999',
    ship_from_city:  'Chicago',
    ship_from_state: 'IL',
    origin_zip:      '60601',
  });
  assert.equal(loc.city,  'Chicago');
  assert.equal(loc.state, 'IL');
  assert.equal(loc.zip,   '60601');
});

test('locationFromOrderOrigin returns blank Location for empty input', () => {
  const loc = locationFromOrderOrigin({});
  assert.equal(loc.name,  '');
  assert.equal(loc.city,  '');
  assert.equal(loc.state, '');
  assert.equal(loc.zip,   '');
});

// ── locationFromOrderDest ────────────────────────────────────────────

test('locationFromOrderDest parses a CITY, ST ZIP dest string', () => {
  const loc = locationFromOrderDest({ dest: 'DALLAS, TX 75201', ship_to_name: 'Dallas Warehouse' });
  assert.equal(loc.name,  'Dallas Warehouse');
  assert.equal(loc.city,  'DALLAS');
  assert.equal(loc.state, 'TX');
  assert.equal(loc.zip,   '75201');
});

test('QA #155 — destination falls back to ship_to_city / ship_to_state', () => {
  const loc = locationFromOrderDest({
    dest: '',
    ship_to_name:  'Houston DC',
    ship_to_city:  'Houston',
    ship_to_state: 'TX',
    dest_zip:      '77001',
  });
  assert.equal(loc.name,  'Houston DC');
  assert.equal(loc.city,  'Houston');
  assert.equal(loc.state, 'TX');
  assert.equal(loc.zip,   '77001');
});

test('QA #155 — destination accepts camelCase aliases', () => {
  const loc = locationFromOrderDest({
    dest: '',
    destCity:  'Phoenix',
    destState: 'AZ',
    destZip:   '85001',
  });
  assert.equal(loc.city,  'Phoenix');
  assert.equal(loc.state, 'AZ');
  assert.equal(loc.zip,   '85001');
});

// ── shipment variants share the same fix ─────────────────────────────

test('QA #155 — shipment origin falls back to ship_from_city / ship_from_state', () => {
  const loc = locationFromShipmentOrigin({
    origin: '',
    ship_from_name:  'Atlanta Hub',
    ship_from_city:  'Atlanta',
    ship_from_state: 'GA',
    origin_zip:      '30301',
  });
  assert.equal(loc.name,  'Atlanta Hub');
  assert.equal(loc.city,  'Atlanta');
  assert.equal(loc.state, 'GA');
  assert.equal(loc.zip,   '30301');
});

test('QA #155 — shipment dest falls back to ship_to_city / ship_to_state', () => {
  const loc = locationFromShipmentDest({
    dest: '',
    ship_to_name:  'Phoenix Hub',
    ship_to_city:  'Phoenix',
    ship_to_state: 'AZ',
    dest_zip:      '85001',
  });
  assert.equal(loc.name,  'Phoenix Hub');
  assert.equal(loc.city,  'Phoenix');
  assert.equal(loc.state, 'AZ');
  assert.equal(loc.zip,   '85001');
});

// ── parseAddressString sanity (regression guard for the helper) ──────

test('parseAddressString handles "CITY, ST ZIP"', () => {
  const p = parseAddressString('CHICAGO, IL 60601');
  assert.equal(p.city,  'CHICAGO');
  assert.equal(p.state, 'IL');
  assert.equal(p.zip,   '60601');
});

test('parseAddressString handles "City, ST" without zip', () => {
  const p = parseAddressString('Boston, MA');
  assert.equal(p.city,  'Boston');
  assert.equal(p.state, 'MA');
  assert.equal(p.zip,   '');
});

test('parseAddressString returns blanks for empty input', () => {
  const p = parseAddressString('');
  assert.equal(p.city,  '');
  assert.equal(p.state, '');
  assert.equal(p.zip,   '');
});
