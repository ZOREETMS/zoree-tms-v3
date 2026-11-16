// Domains (migration 052): request rewriting, fetch wrapper, middleware.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scopeRequest, tableOf } = require('../services/domains/domainScope');
const { makeScopedFetch } = require('../services/domains/scopedFetch');
const { runInDomain, currentDomain } = require('../services/domains/domainContext');
const { createDomainScopeMiddleware, subjectOf } = require('../middleware/domainScope');
const { pickDomain } = require('../services/domains/domainAccess');

const BASE = 'https://x.supabase.co/rest/v1/';

test('tableOf reads the table and ignores rpc', () => {
  assert.equal(tableOf(`${BASE}shipments?id=eq.1`, BASE), 'shipments');
  assert.equal(tableOf(`${BASE}rpc/next_id`, BASE), null);
  assert.equal(tableOf('https://x.supabase.co/auth/v1/user', BASE), null);
});

test('reads, updates and deletes on scoped tables get a domain filter', () => {
  for (const method of ['GET', 'HEAD', 'DELETE']) {
    const out = scopeRequest({ url: `${BASE}invoices?select=*`, method }, 'KESTREL_BAY', BASE);
    assert.equal(out.url, `${BASE}invoices?select=*&domain_code=eq.KESTREL_BAY`);
  }
  const noQuery = scopeRequest({ url: `${BASE}rates` }, 'ZOREE', BASE);
  assert.equal(noQuery.url, `${BASE}rates?domain_code=eq.ZOREE`);
});

test('inserts are stamped with the domain; explicit domain kept', () => {
  const one = scopeRequest({ url: `${BASE}shipments`, method: 'POST', body: JSON.stringify({ id: 'S1' }) }, 'KESTREL_BAY', BASE);
  assert.deepEqual(JSON.parse(one.body), { id: 'S1', domain_code: 'KESTREL_BAY' });
  const many = scopeRequest({ url: `${BASE}orders?on_conflict=id`, method: 'POST', body: JSON.stringify([{ id: 'A' }, { id: 'B', domain_code: 'ZOREE' }]) }, 'KESTREL_BAY', BASE);
  assert.deepEqual(JSON.parse(many.body).map((r) => r.domain_code), ['KESTREL_BAY', 'ZOREE']);
  assert.equal(many.url, `${BASE}orders?on_conflict=id`);
});

test('updates cannot move a row to another domain', () => {
  const out = scopeRequest({ url: `${BASE}shipments?id=eq.S1`, method: 'PATCH', body: JSON.stringify({ status: 'Delivered', domain_code: 'ZOREE' }) }, 'KESTREL_BAY', BASE);
  assert.deepEqual(JSON.parse(out.body), { status: 'Delivered' });
  assert.match(out.url, /domain_code=eq\.KESTREL_BAY$/);
});

test('unscoped tables, rpc and explicit filters are left alone', () => {
  assert.equal(scopeRequest({ url: `${BASE}order_lines?order_id=eq.1` }, 'KESTREL_BAY', BASE).scoped, false);
  assert.equal(scopeRequest({ url: `${BASE}rpc/x`, method: 'POST', body: '{}' }, 'KESTREL_BAY', BASE).scoped, false);
  const explicit = scopeRequest({ url: `${BASE}rates?domain_code=eq.ZOREE` }, 'KESTREL_BAY', BASE);
  assert.equal(explicit.url, `${BASE}rates?domain_code=eq.ZOREE`);
});

test('scoped fetch uses the domain of the running request', async () => {
  const seen = [];
  const f = makeScopedFetch(async (url, init) => { seen.push({ url, body: init && init.body }); return { ok: true }; }, BASE);
  await runInDomain('KESTREL_BAY', () => f(`${BASE}shipments?select=id`));
  await f(`${BASE}shipments?select=id`); // outside a request → default
  await f('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{}' });
  assert.equal(seen[0].url, `${BASE}shipments?select=id&domain_code=eq.KESTREL_BAY`);
  assert.equal(seen[1].url, `${BASE}shipments?select=id&domain_code=eq.ZOREE`);
  assert.equal(seen[2].url, 'https://api.anthropic.com/v1/messages');
});

test('domain context survives awaits', async () => {
  const d = await runInDomain('KESTREL_BAY', async () => { await new Promise((r) => setTimeout(r, 5)); return currentDomain(); });
  assert.equal(d, 'KESTREL_BAY');
  assert.equal(currentDomain(), 'ZOREE');
});

function jwtFor(sub) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `Bearer ${b({ alg: 'HS256' })}.${b({ sub })}.sig`;
}
function run(mw, headers) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); } };
    mw({ headers }, res, () => resolve({ status: 200, domain: currentDomain() }));
  });
}

test('middleware: default, allowed switch, forbidden domain, no token', async () => {
  const access = { u1: [{ code: 'ZOREE', name: 'Zoree', isDefault: true }, { code: 'KESTREL_BAY', name: 'KB', isDefault: false }],
                   u2: [{ code: 'ZOREE', name: 'Zoree', isDefault: true }] };
  const mw = createDomainScopeMiddleware({ listForUser: async (id) => access[id] });
  assert.equal((await run(mw, { authorization: jwtFor('u1') })).domain, 'ZOREE');
  assert.equal((await run(mw, { authorization: jwtFor('u1'), 'x-zoree-domain': 'kestrel_bay' })).domain, 'KESTREL_BAY');
  assert.equal((await run(mw, { authorization: jwtFor('u2'), 'x-zoree-domain': 'KESTREL_BAY' })).status, 403);
  assert.equal((await run(mw, {})).domain, 'ZOREE');
  assert.equal((await run(mw, { 'x-zoree-domain': 'KESTREL_BAY' })).domain, 'ZOREE'); // login must work with a remembered domain
  assert.equal((await run(mw, { authorization: jwtFor('u1'), 'x-zoree-domain': 'bad domain!' })).status, 400);
});

test('subjectOf and pickDomain', () => {
  assert.equal(subjectOf(jwtFor('abc')), 'abc');
  assert.equal(subjectOf('ApiKey xyz'), null);
  const ds = [{ code: 'ZOREE', isDefault: false }, { code: 'KESTREL_BAY', isDefault: true }];
  assert.equal(pickDomain(ds, null), 'KESTREL_BAY');
  assert.equal(pickDomain(ds, 'ACME'), null);
});
