'use strict';

// Lane mileage estimate used when a rate row has no miles.

const test = require('node:test');
const assert = require('node:assert');
const { zipOf, roadMiles, estimateLaneMiles } = require('../services/laneMiles');

const fakeDb = (rows, error = null) => ({ from: () => ({ select: () => ({ in: async () => ({ data: rows, error }) }) }) });
const ATL = { zip: '30337', lat: 33.64, lng: -84.45 };
const DAL = { zip: '75207', lat: 32.79, lng: -96.83 };

test('zipOf: pulls the 5-digit ZIP, trims ZIP+4, null when absent', () => {
  assert.strictEqual(zipOf('ASHCAMP, KY 41512'), '41512');
  assert.strictEqual(zipOf('Chicago, IL 60601-1234'), '60601');
  assert.strictEqual(zipOf('Ashcamp, Ky'), null);
  assert.strictEqual(zipOf(null), null);
});

test('roadMiles: College Park GA -> Dallas TX lands near the known ~780 road miles', () => {
  const mi = roadMiles(ATL, DAL);
  assert.ok(mi > 700 && mi < 900, `got ${mi}`);
});

test('roadMiles: null when a point is missing; never 0 for the same point', () => {
  assert.strictEqual(roadMiles(ATL, null), null);
  assert.strictEqual(roadMiles({ lat: 'x', lng: 1 }, DAL), null);
  assert.strictEqual(roadMiles(ATL, ATL), 1);
});

test('estimateLaneMiles: resolves both ZIPs from zip_geo', async () => {
  const mi = await estimateLaneMiles(fakeDb([ATL, DAL]), 'COLLEGE PARK, GA 30337', 'DALLAS, TX 75207');
  assert.ok(mi > 700 && mi < 900);
});

test('estimateLaneMiles: null when a ZIP is missing from the text or the table', async () => {
  assert.strictEqual(await estimateLaneMiles(fakeDb([ATL, DAL]), 'College Park, GA', 'DALLAS, TX 75207'), null);
  assert.strictEqual(await estimateLaneMiles(fakeDb([ATL]), 'COLLEGE PARK, GA 30337', 'DALLAS, TX 75207'), null);
});

test('estimateLaneMiles: surfaces a zip_geo read error', async () => {
  await assert.rejects(() => estimateLaneMiles(fakeDb(null, { message: 'boom' }), 'A 30337', 'B 75207'), /zip_geo/);
});
