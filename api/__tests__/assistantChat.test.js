'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chat, buildRequest } = require('../services/ai/assistantChat');

const env = { ANTHROPIC_API_KEY: 'sk-test' };
const msgs = [{ role: 'user', content: 'Shipment summary' }];
const ok = (body) => async () => ({ ok: true, status: 200, json: async () => body });

test('the server adds its own key; the browser sends none', async () => {
  let seen;
  const r = await chat({ system: 'ctx', messages: msgs }, { env, fetchImpl: async (url, o) => { seen = o; return ok({ content: [{ text: 'hi' }], model: 'm' })(); } });
  assert.equal(r.text, 'hi');
  assert.equal(seen.headers['x-api-key'], 'sk-test');
  const body = JSON.parse(seen.body);
  assert.equal(body.max_tokens, 2048);
  assert.equal(body.system[0].cache_control.type, 'ephemeral');
});

test('model and token cap are fixed on the server', () => {
  const b = buildRequest({ system: 'ctx', messages: msgs, model: 'other', max_tokens: 99999 }, env);
  assert.equal(b.model, 'claude-sonnet-4-6');
  assert.equal(b.max_tokens, 2048);
});

test('bad input is refused before any call', () => {
  assert.throws(() => buildRequest({ system: '', messages: msgs }, env), /system prompt/);
  assert.throws(() => buildRequest({ system: 'x', messages: [] }, env), /messages are required/);
  assert.throws(() => buildRequest({ system: 'x', messages: [{ role: 'system', content: 'x' }] }, env), /role/);
  assert.throws(() => buildRequest({ system: 'x', messages: [{ role: 'assistant', content: 'x' }] }, env), /last message/);
  assert.throws(() => buildRequest({ system: 'x', messages: [{ role: 'user', content: 'a'.repeat(20001) }] }, env), /too long/);
});

test('only the most recent 30 messages are sent', () => {
  const many = Array.from({ length: 41 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
  assert.equal(buildRequest({ system: 'x', messages: many }, env).messages.length, 30);
});

test('no key on the server: 503 with what to fix; rejected key: no raw provider error', async () => {
  await assert.rejects(() => chat({ system: 'x', messages: msgs }, { env: {} }), (e) => e.status === 503 && /ANTHROPIC_API_KEY/.test(e.message));
  await assert.rejects(() => chat({ system: 'x', messages: msgs }, { env, fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) }) }),
    (e) => e.status === 502 && /Update ANTHROPIC_API_KEY/.test(e.message));
});
