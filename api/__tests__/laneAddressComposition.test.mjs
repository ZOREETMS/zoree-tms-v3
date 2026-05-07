// Regression tests for QA #141 — AI plan was creating shipments with
// just the city in shipment.origin/dest. Lane construction now composes
// "CITY, ST ZIP" from the typed columns when the legacy free-text
// origin is incomplete.
//
// Run with: node --test api/__tests__/laneAddressComposition.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lanePath = path.resolve(__dirname, '../../frontend/src/utils/laneUtils.js');
const lane = await import(pathToFileURL(lanePath).href);
const { fullOrderOrigin, fullOrderDest, buildSingleOrderLane, buildLaneGroups } = lane;

test('passthrough when raw origin already has state + ZIP', () => {
  const order = { origin: 'COLLEGE PARK, GA 30350' };
  assert.equal(fullOrderOrigin(order), 'COLLEGE PARK, GA 30350');
});

test('passthrough when raw origin has state but no ZIP', () => {
  const order = { origin: 'CHICAGO, IL' };
  assert.equal(fullOrderOrigin(order), 'CHICAGO, IL');
});

test('QA #141 — composes from typed columns when raw origin is just city', () => {
  const order = {
    origin: 'Atlanta',
    ship_from_city:  'Atlanta',
    ship_from_state: 'GA',
    origin_zip:      '30301',
  };
  assert.equal(fullOrderOrigin(order), 'ATLANTA, GA 30301');
});

test('QA #141 — composes when raw origin is empty', () => {
  const order = {
    origin: '',
    ship_from_city:  'Dallas',
    ship_from_state: 'TX',
    origin_zip:      '75201',
  };
  assert.equal(fullOrderOrigin(order), 'DALLAS, TX 75201');
});

test('QA #141 — falls back to raw origin when no typed columns available', () => {
  const order = { origin: 'Atlanta' };
  // No state/zip available anywhere — return what we have rather than
  // synthesizing a fake address.
  assert.equal(fullOrderOrigin(order), 'Atlanta');
});

test('QA #141 — composes city+state without zip', () => {
  const order = {
    origin: 'Houston',
    ship_from_city:  'Houston',
    ship_from_state: 'TX',
  };
  assert.equal(fullOrderOrigin(order), 'HOUSTON, TX');
});

test('QA #141 — fullOrderDest mirrors the same logic on the dest side', () => {
  const order = {
    dest: 'Phoenix',
    ship_to_city:  'Phoenix',
    ship_to_state: 'AZ',
    dest_zip:      '85001',
  };
  assert.equal(fullOrderDest(order), 'PHOENIX, AZ 85001');
});

test('QA #141 — also reads origin_city/origin_state when ship_from_* is empty', () => {
  const order = {
    origin: 'Newark',
    origin_city:  'Newark',
    origin_state: 'NJ',
    origin_zip:   '07102',
  };
  assert.equal(fullOrderOrigin(order), 'NEWARK, NJ 07102');
});

test('buildSingleOrderLane uses the composed origin/dest (#141)', () => {
  const order = {
    id: 'ORD-1',
    origin: 'Atlanta',
    dest:   'Dallas',
    ship_from_city: 'Atlanta',  ship_from_state: 'GA', origin_zip: '30301',
    ship_to_city:   'Dallas',   ship_to_state:   'TX', dest_zip:   '75201',
    weight: 5000, pieces: 10,
  };
  const result = buildSingleOrderLane(order);
  assert.equal(result.origin,      'ATLANTA, GA 30301');
  assert.equal(result.destination, 'DALLAS, TX 75201');
  assert.equal(result.originZip,   '30301');
  assert.equal(result.destZip,     '75201');
  assert.deepEqual(result.orderIds, ['ORD-1']);
});

test('buildLaneGroups uses the composed origin/dest (#141)', () => {
  const orders = [
    {
      id: 'ORD-1', origin: 'Atlanta', dest: 'Dallas',
      ship_from_city: 'Atlanta', ship_from_state: 'GA', origin_zip: '30301',
      ship_to_city:   'Dallas',  ship_to_state:   'TX', dest_zip:   '75201',
      weight: 1000, pieces: 5,
    },
    {
      id: 'ORD-2', origin: 'Atlanta', dest: 'Dallas',
      ship_from_city: 'Atlanta', ship_from_state: 'GA', origin_zip: '30301',
      ship_to_city:   'Dallas',  ship_to_state:   'TX', dest_zip:   '75201',
      weight: 2000, pieces: 8,
    },
  ];
  const groups = buildLaneGroups(orders);
  assert.equal(groups.length, 1, 'identical lanes consolidate');
  assert.equal(groups[0].origin,      'ATLANTA, GA 30301');
  assert.equal(groups[0].destination, 'DALLAS, TX 75201');
  assert.equal(groups[0].totalWeight, 3000);
  assert.equal(groups[0].totalPieces, 13);
});
