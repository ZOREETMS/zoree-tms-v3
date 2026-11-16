'use strict';

// Jev intent gate: pure veto policy, HTTP client contract (mocked fetch),
// mode handling, and the Teams parser refactor it hooks into.

const test = require('node:test');
const os = require('node:os');
const path = require('node:path');

process.env.JEV_DECISION_LOG = path.join(os.tmpdir(), 'jev-decisions.test.log');
const assert = require('node:assert');

const jev = require('../services/ai/jevClient');
const { choice, noul, score } = require('../services/ai/jevQuestions');
const gate = require('../services/ai/intentGate');
const { parseTypedCommand, readOnlyCommand } = require('../services/teamsBot/handlers');

const withEnv = async (vars, fn) => {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; }
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
};

const okResponse = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
const errResponse = (status) => ({ ok: false, status, json: async () => ({}), text: async () => 'nope' });

// ── question builders ─────────────────────────────────────────────
test('question builders emit the raw /v1/systemone shapes', () => {
  assert.deepEqual(choice('Which?', { a: 'A' }), { type: 'choice', instructions: 'Which?', criteria: { a: 'A' } });
  assert.deepEqual(noul('Yes?'), { type: 'noul', instructions: 'Yes?' });
  assert.deepEqual(score('How?', ['low', 'high']), { type: 'score', instructions: 'How?', criteria: ['low', 'high'] });
});

// ── veto policy (pure) ────────────────────────────────────────────
test('read-only commands are never vetoed', () => {
  const d = gate.decide({ isMutating: false, answers: { is_question: { noul: 0.99 } } });
  assert.equal(d.veto, false);
});

test('the 2026-08-09 incident shape is vetoed: mutating verb, but a question', () => {
  const d = gate.decide({
    isMutating: true,
    answers: { is_question: { noul: 0.93 }, intent: { choice: 'rate_quote', confidence: 0.8 } },
  });
  assert.equal(d.veto, true);
});

test('a confident read-only intent vetoes even when p(question) is low', () => {
  const d = gate.decide({
    isMutating: true,
    answers: { is_question: { noul: 0.2 }, intent: { choice: 'status_lookup', confidence: 0.85 } },
  });
  assert.equal(d.veto, true);
});

test('a polite imperative ("can you plan ORD-1") is not vetoed', () => {
  const d = gate.decide({
    isMutating: true,
    answers: { is_question: { noul: 0.15 }, intent: { choice: 'plan', confidence: 0.9 } },
  });
  assert.equal(d.veto, false);
});

test('"other" or low confidence never vetoes a typed command', () => {
  assert.equal(gate.decide({ isMutating: true, answers: { intent: { choice: 'other', confidence: 0.99 } } }).veto, false);
  assert.equal(gate.decide({ isMutating: true, answers: { intent: { choice: 'list', confidence: 0.4 } } }).veto, false);
  assert.equal(gate.decide({ isMutating: true, answers: undefined }).veto, false);
});

test('veto threshold is configurable and bounded', async () => {
  await withEnv({ JEV_VETO_THRESHOLD: '0.9' }, () => assert.equal(gate.getVetoThreshold(), 0.9));
  await withEnv({ JEV_VETO_THRESHOLD: '7' }, () => assert.equal(gate.getVetoThreshold(), 0.7));
  await withEnv({ JEV_VETO_THRESHOLD: undefined }, () => assert.equal(gate.getVetoThreshold(), 0.7));
});

// ── modes ─────────────────────────────────────────────────────────
test('mode is off without a key, shadow by default with one', async () => {
  await withEnv({ TYPESAFE_API_KEY: undefined, JEV_API_KEY: undefined, JEV_MODE: 'enforce' },
    () => assert.equal(gate.getMode(), 'off'));
  await withEnv({ TYPESAFE_API_KEY: 'sk-test', JEV_MODE: undefined }, () => assert.equal(gate.getMode(), 'shadow'));
  await withEnv({ TYPESAFE_API_KEY: 'sk-test', JEV_MODE: 'ENFORCE' }, () => assert.equal(gate.getMode(), 'enforce'));
  await withEnv({ TYPESAFE_API_KEY: 'sk-test', JEV_MODE: 'bogus' }, () => assert.equal(gate.getMode(), 'shadow'));
});

test('off mode makes no network call', async () => {
  await withEnv({ TYPESAFE_API_KEY: undefined, JEV_API_KEY: undefined }, async () => {
    let called = false;
    const r = await gate.review({ text: 'plan ORD-1', regexCmd: 'plan', isMutating: true, opts: { fetch: () => { called = true; } } });
    assert.deepEqual(r, { mode: 'off', veto: false });
    assert.equal(called, false);
  });
});

test('enforce mode vetoes a question and fails open when Jev is down', async () => {
  await withEnv({ TYPESAFE_API_KEY: 'sk-test', JEV_MODE: 'enforce' }, async () => {
    const question = await gate.review({
      text: 'what carriers can plan ORD-1', regexCmd: 'plan', isMutating: true,
      opts: { fetch: async () => okResponse({ model: 'jev-1.13.0', answers: { is_question: { noul: 0.95 }, intent: { choice: 'rate_quote', confidence: 0.9 } } }) },
    });
    assert.equal(question.veto, true);

    const down = await gate.review({
      text: 'plan ORD-1', regexCmd: 'plan', isMutating: true,
      opts: { fetch: async () => errResponse(500) },
    });
    assert.equal(down.veto, false);
  });
});

// ── HTTP client ───────────────────────────────────────────────────
test('client posts model/state/questions with a bearer key', async () => {
  let seen;
  const fetch = async (url, init) => { seen = { url, init }; return okResponse({ model: 'jev-1.13.0', answers: {} }); };
  const r = await jev.systemOne({ message: 'hi' }, { q: noul('x') }, { fetch, config: { apiKey: 'sk-test', model: 'jev-1.13.0', baseUrl: 'https://api.typesafe.ai', timeoutMs: 1000 } });
  assert.equal(seen.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(seen.init.headers.Authorization, 'Bearer sk-test');
  assert.deepEqual(JSON.parse(seen.init.body), { model: 'jev-1.13.0', state: { message: 'hi' }, questions: { q: { type: 'noul', instructions: 'x' } } });
  assert.equal(r.model, 'jev-1.13.0');
  assert.equal(typeof r.latencyMs, 'number');
});

test('client retries once on 429, not on 401', async () => {
  const cfg = { apiKey: 'sk-test', model: 'm', baseUrl: 'https://x', timeoutMs: 1000 };
  let calls = 0;
  const flaky = async () => { calls += 1; return calls === 1 ? errResponse(429) : okResponse({ answers: {} }); };
  await jev.systemOne('s', {}, { fetch: flaky, config: cfg });
  assert.equal(calls, 2);

  calls = 0;
  const unauthorized = async () => { calls += 1; return errResponse(401); };
  await assert.rejects(jev.systemOne('s', {}, { fetch: unauthorized, config: cfg }), (e) => e.status === 401);
  assert.equal(calls, 1);
});

test('client refuses to call without a key', async () => {
  await assert.rejects(jev.systemOne('s', {}, { config: { apiKey: '' } }), /TYPESAFE_API_KEY/);
});

// ── Teams parser refactor: behaviour unchanged ────────────────────
test('parser: imperatives act, questions fall to read-only', () => {
  assert.deepEqual(parseTypedCommand('can you plan ORD-123 XPO'), { cmd: 'plan', arg1: 'ORD-123', arg2: 'XPO' });
  assert.deepEqual(parseTypedCommand('what are different carrier options available to plan ORD-9'), { cmd: 'rate', arg1: 'ORD-9', arg2: '' });
  assert.deepEqual(parseTypedCommand('is SHP-44 delivered?'), { cmd: 'shipment', arg1: 'SHP-44', arg2: '' });
  assert.equal(parseTypedCommand('help').cmd, 'help');
  assert.deepEqual(readOnlyCommand('can you plan ORD-5'), { cmd: 'order', arg1: 'ORD-5', arg2: '' });
});
