'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('../services/emailIntake/graphMailbox');

const ENV = {
  EMAIL_INTAKE_AP_PROVIDER: 'graph',
  EMAIL_INTAKE_AP_GRAPH_MAILBOX: 'AP@kestrelbay.zoree.io',
  MS_SSO_TENANT_ID: '29805e36-0e8f-46ef-9588-a77cd8653cc5',
  MS_GRAPH_CLIENT_ID: 'client', MS_GRAPH_CLIENT_SECRET: 'secret',
};

function fakeFetch(routes, calls = []) {
  return async (url, opts = {}) => {
    calls.push({ url, opts });
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) return { ok: false, status: 404, text: async () => '{"error":{"message":"nope"}}', json: async () => ({}) };
    const body = hit[1](url, opts);
    return {
      ok: true, status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
      arrayBuffer: async () => Buffer.from(String(body)),
    };
  };
}

test('settings, provider switch and poll interval', () => {
  assert.equal(g.isGraph(ENV), true);
  assert.equal(g.isGraph({}), false);
  assert.equal(g.isConfigured(ENV), true);
  assert.equal(g.isConfigured({ ...ENV, MS_GRAPH_CLIENT_SECRET: '' }), false);
  assert.equal(g.settings(ENV).mailbox, 'ap@kestrelbay.zoree.io');
  assert.equal(g.settings(ENV).tenantId, ENV.MS_SSO_TENANT_ID);
  assert.equal(g.pollSeconds({}), 15);
  assert.equal(g.pollSeconds({ EMAIL_INTAKE_AP_GRAPH_POLL_SECONDS: '2' }), 15);
  assert.equal(g.pollSeconds({ EMAIL_INTAKE_AP_GRAPH_POLL_SECONDS: '30' }), 30);
});

test('token is requested with client credentials and cached', async () => {
  const calls = [];
  const fetchImpl = fakeFetch([[/oauth2\/v2.0\/token/, () => ({ access_token: 'T1', expires_in: 3600 })]], calls);
  const token = g.createTokenSource({ fetchImpl, env: ENV });
  assert.equal(await token(), 'T1');
  assert.equal(await token(), 'T1');
  assert.equal(calls.length, 1);
  assert.match(calls[0].opts.body, /grant_type=client_credentials/);
  assert.match(calls[0].opts.body, /scope=https%3A%2F%2Fgraph.microsoft.com%2F.default/);
  assert.match(calls[0].url, /29805e36-0e8f-46ef-9588-a77cd8653cc5/);
});

test('client only reads: inbox list, newest id, MIME', async () => {
  const calls = [];
  const fetchImpl = fakeFetch([
    [/\$value$/, () => 'MIME'],
    [/messages\?/, (url) => (/top=1(&|$)/.test(url) ? { value: [{ id: 'm9' }] } : { value: [{ id: 'm1', hasAttachments: true }] })],
  ], calls);
  const c = g.createClient({ fetchImpl, env: ENV, token: async () => 'T' });
  assert.equal(await c.latestId(), 'm9');
  assert.equal((await c.recent()).length, 1);
  assert.equal(String(await c.mime('m1')), 'MIME');
  assert.ok(calls.every((x) => !x.opts.method || x.opts.method === 'GET'), 'never writes');
  assert.ok(calls.every((x) => x.url.includes('/users/ap%40kestrelbay.zoree.io/')));
  assert.ok(calls.every((x) => x.opts.headers.Authorization === 'Bearer T'));
});

test('fetchNewEmails skips seen and attachment-less mail, parses the rest', async () => {
  const old = { ...process.env };
  Object.assign(process.env, ENV);
  try {
    const client = {
      recent: async () => [
        { id: 'a', internetMessageId: '<seen@x>', hasAttachments: true, receivedDateTime: '2026-11-17T10:00:00Z' },
        { id: 'b', internetMessageId: '<new@x>', hasAttachments: true, receivedDateTime: '2026-11-17T11:00:00Z' },
        { id: 'c', internetMessageId: '<noatt@x>', hasAttachments: false },
      ],
      mime: async (id) => Buffer.from(`mime-${id}`),
    };
    const out = await g.fetchNewEmails({
      client,
      isSeen: async () => new Set(['seen@x']),
      parse: async (buf) => ({ raw: String(buf) }),
      toEmail: (p, meta) => ({ messageId: meta.messageId, raw: p.raw }),
      normalizeMessageId: (id) => String(id || '').replace(/^<|>$/g, ''),
    });
    assert.equal(out.scanned, 2);
    assert.deepEqual(out.emails, [{ messageId: 'new@x', raw: 'mime-b' }]);
  } finally {
    process.env = old;
  }
});

test('fetchNewEmails refuses when not configured', async () => {
  const old = { ...process.env };
  delete process.env.MS_GRAPH_CLIENT_SECRET;
  delete process.env.EMAIL_INTAKE_AP_GRAPH_MAILBOX;
  try {
    await assert.rejects(() => g.fetchNewEmails({ client: {}, isSeen: async () => new Set() }), /not set up/);
  } finally {
    process.env = old;
  }
});

test('watcher: catch-up at start, fires only when the newest id changes, records errors', async () => {
  const fired = [];
  let id = 'm1';
  let fail = false;
  const w = g.createGraphWatcher({
    onNewMail: (r) => fired.push(r),
    peek: async () => { if (fail) throw new Error('graph down'); return id; },
    timers: { setInterval: () => 1, clearInterval: () => {} },
  });
  await w._check(true);
  assert.deepEqual(fired, ['catch-up']);
  await w._check(false);
  assert.deepEqual(fired, ['catch-up']);
  id = 'm2';
  await w._check(false);
  assert.deepEqual(fired, ['catch-up', 'new-email']);
  assert.equal(w.status().connected, true);
  fail = true;
  await w._check(false);
  assert.equal(w.status().connected, false);
  assert.equal(w.status().lastError, 'graph down');
  fail = false; id = 'm3';
  await w._check(false);
  assert.deepEqual(fired, ['catch-up', 'new-email', 'new-email']);
});
