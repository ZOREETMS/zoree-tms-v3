// Tests for modules extracted in the 2026-10-25 rules audit:
// services/db/pagedRead, middleware/authUserCache, emailIntake parseSender.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { fetchAllRows } = require('../services/db/pagedRead');
const { createAuthUserCache } = require('../middleware/authUserCache');
const { parseSender } = require('../services/emailIntake/intakeService');

function fakeFetch(total) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const limit = Number(u.searchParams.get('limit'));
    const offset = Number(u.searchParams.get('offset'));
    const rows = [];
    for (let i = offset; i < Math.min(total, offset + limit); i++) rows.push({ id: i });
    return { ok: true, json: async () => rows, text: async () => '' };
  };
  return { impl, calls };
}

test('fetchAllRows pages past the 1000-row cap and stops on a short page', async () => {
  const f = fakeFetch(2500);
  const rows = await fetchAllRows('https://x/rest/v1/rates?select=*', { fetchImpl: f.impl, headers: {} });
  assert.strictEqual(rows.length, 2500);
  assert.strictEqual(f.calls.length, 3);
  assert.match(f.calls[0], /order=id\.asc&limit=1000&offset=0/);
});

test('fetchAllRows honours max and surfaces HTTP errors', async () => {
  const f = fakeFetch(5000);
  const rows = await fetchAllRows('https://x/r?select=*', { fetchImpl: f.impl, max: 2000 });
  assert.strictEqual(rows.length, 2000);
  const bad = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  await assert.rejects(fetchAllRows('https://x/r', { fetchImpl: bad }), /DB read failed \(500\): boom/);
});

test('authUserCache expires after TTL and clones payloads', () => {
  let t = 0;
  const c = createAuthUserCache({ ttlMs: 1000, now: () => t });
  c.set('tok', { id: 'u1' });
  const a = c.get('tok'); a.roles = ['admin'];
  assert.deepStrictEqual(c.get('tok'), { id: 'u1' }); // mutation did not leak
  t = 1000;
  assert.strictEqual(c.get('tok'), null);
});

test('authUserCache bounds its size and invalidates', () => {
  let t = 0;
  const c = createAuthUserCache({ ttlMs: 10, maxEntries: 2, now: () => t });
  c.set('a', {}); c.set('b', {}); c.set('c', {});
  assert.ok(c.size() <= 3);
  t = 20; c.set('d', {});
  assert.strictEqual(c.size(), 1);
  c.invalidate('d'); assert.strictEqual(c.get('d'), null);
});

test('parseSender handles display names and bare addresses', () => {
  assert.deepStrictEqual(parseSender('"Jane Doe" <Jane@X.com>'), { fromAddress: 'jane@x.com', fromName: 'Jane Doe' });
  assert.deepStrictEqual(parseSender('ops@acme.com'), { fromAddress: 'ops@acme.com', fromName: null });
  assert.deepStrictEqual(parseSender(''), { fromAddress: null, fromName: null });
});
