'use strict';

// Demo-safety features around the Jev gate:
//   • TEAMS_BOT_DRY_RUN — data-changing commands reply "would …" only
//   • JEV_FAIL_MODE=closed — Jev unavailable ⇒ only bare commands may act
//   • jevEval — metrics are computed from the runs, not asserted

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');

process.env.JEV_DECISION_LOG = path.join(os.tmpdir(), 'jev-decisions.test.log');

const { shouldDryRun, dryRunReply } = require('../services/teamsBot/dryRun');
const gate = require('../services/ai/intentGate');
const { handleActivity } = require('../services/teamsBot/handlers');
const { runEval, keywordResult, percentile } = require('../services/ai/jevEval');

const withEnv = async (vars, fn) => {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
};

const withFetch = async (impl, fn) => {
  const saved = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = saved; }
};

const typed = (text) => ({ type: 'message', text });
const clicked = (value) => ({ type: 'message', value });
const downFetch = async () => { throw new Error('network down'); };

// ── dry run ───────────────────────────────────────────────────────
test('dry run is off unless TEAMS_BOT_DRY_RUN=true', async () => {
  await withEnv({ TEAMS_BOT_DRY_RUN: undefined }, () => assert.equal(shouldDryRun('plan', 'ORD-1'), false));
  await withEnv({ TEAMS_BOT_DRY_RUN: 'TRUE' }, () => assert.equal(shouldDryRun('plan', 'ORD-1'), true));
});

test('dry run covers data changes only, and only with an id', async () => {
  await withEnv({ TEAMS_BOT_DRY_RUN: 'true' }, () => {
    for (const cmd of ['plan', 'tender', 'accept', 'reject', 'withdraw', 'unplan', 'delivered', 'intransit']) {
      assert.equal(shouldDryRun(cmd, 'X-1'), true, cmd);
    }
    for (const cmd of ['rate', 'order', 'shipment', 'today', 'clear', 'help']) {
      assert.equal(shouldDryRun(cmd, 'X-1'), false, cmd);
    }
    assert.equal(shouldDryRun('plan', ''), false);
  });
  assert.match(dryRunReply('plan', 'ORD-1', 'XPO').text, /would run `plan ORD-1 XPO`/);
});

test('dry run: typed and button commands never reach the TMS', async () => {
  await withEnv({ TEAMS_BOT_DRY_RUN: 'true', TYPESAFE_API_KEY: undefined, JEV_API_KEY: undefined }, async () => {
    let tmsCalls = 0;
    await withFetch(async () => { tmsCalls += 1; throw new Error('should not be called'); }, async () => {
      const a = await handleActivity(typed('tender SHP-2026-209837'));
      const b = await handleActivity(clicked({ cmd: 'accept', id: 'SHP-2026-783705' }));
      assert.match(a.text, /Dry run.*tender SHP-2026-209837/);
      assert.match(b.text, /Dry run.*accept SHP-2026-783705/);
    });
    assert.equal(tmsCalls, 0);
  });
});

// ── fail-closed ───────────────────────────────────────────────────
test('bare-command detection', () => {
  assert.equal(gate.isBareCommand('plan ORD-1', 'plan'), true);
  assert.equal(gate.isBareCommand('Tender, SHP-1', 'tender'), true);
  assert.equal(gate.isBareCommand('can you plan ORD-1', 'plan'), false);
  assert.equal(gate.isBareCommand('tell me the options to plan ORD-1', 'plan'), false);
});

test('Jev unavailable: open lets everything through, closed only bare commands', () => {
  const base = { regexCmd: 'plan', isMutating: true, error: 'down' };
  assert.equal(gate.decideOnUnavailable({ ...base, text: 'tell me options to plan ORD-1', failMode: 'open' }).veto, false);
  const closed = gate.decideOnUnavailable({ ...base, text: 'tell me options to plan ORD-1', failMode: 'closed' });
  assert.equal(closed.veto, true);
  assert.equal(closed.kind, 'unavailable');
  assert.equal(gate.decideOnUnavailable({ ...base, text: 'plan ORD-1', failMode: 'closed' }).veto, false);
  assert.equal(gate.decideOnUnavailable({ ...base, isMutating: false, text: 'rate ORD-1', failMode: 'closed' }).veto, false);
});

test('JEV_FAIL_MODE defaults to open', async () => {
  await withEnv({ JEV_FAIL_MODE: undefined }, () => assert.equal(gate.getFailMode(), 'open'));
  await withEnv({ JEV_FAIL_MODE: 'Closed' }, () => assert.equal(gate.getFailMode(), 'closed'));
});

test('end to end: enforce + closed + Jev down', async () => {
  const env = { TYPESAFE_API_KEY: 'sk-test', JEV_MODE: 'enforce', JEV_FAIL_MODE: 'closed', TEAMS_BOT_DRY_RUN: 'true' };
  await withEnv(env, () => withFetch(downFetch, async () => {
    // ambiguous phrasing → blocked, visible note, falls to read-only lookup
    const blocked = await handleActivity(typed('tell me the carrier options to plan ORD-140346'));
    assert.match(blocked.text, /Couldn't verify what you meant/);
    assert.doesNotMatch(blocked.text, /Dry run/);
    // bare command → allowed (reaches dry run, so still nothing changes)
    const bare = await handleActivity(typed('plan ORD-140346'));
    assert.match(bare.text, /Dry run.*plan ORD-140346/);
    assert.doesNotMatch(bare.text, /Couldn't verify/);
  }));
});

test('end to end: enforce + open + Jev down keeps today\'s behaviour', async () => {
  const env = { TYPESAFE_API_KEY: 'sk-test', JEV_MODE: 'enforce', JEV_FAIL_MODE: 'open', TEAMS_BOT_DRY_RUN: 'true' };
  await withEnv(env, () => withFetch(downFetch, async () => {
    const r = await handleActivity(typed('tell me the carrier options to plan ORD-140346'));
    assert.match(r.text, /Dry run.*plan ORD-140346/); // keyword misfire goes through (fail-open)
  }));
});

test('end to end: enforce + Jev says question → question note', async () => {
  const env = { TYPESAFE_API_KEY: 'sk-test', JEV_MODE: 'enforce', TEAMS_BOT_DRY_RUN: 'true' };
  const jevSaysQuestion = async (url) => {
    if (String(url).includes('/v1/systemone')) {
      return { ok: true, status: 200, json: async () => ({ model: 'jev-1.13.0', answers: { is_question: { noul: 0.96 }, intent: { choice: 'rate_quote', confidence: 0.9 } } }) };
    }
    throw new Error('TMS unreachable in test');
  };
  await withEnv(env, () => withFetch(jevSaysQuestion, async () => {
    const r = await handleActivity(typed('tell me the carrier options to plan ORD-140346'));
    assert.match(r.text, /Read as a question/);
  }));
});

// ── evaluation metrics ────────────────────────────────────────────
test('keyword baseline flags data changes only when an id is present', () => {
  assert.equal(keywordResult('tell me the carrier options to plan ORD-1').wouldChangeData, true);
  assert.equal(keywordResult('need to know if SHP-1 is delivered').wouldChangeData, false); // id before verb → usage only
  assert.equal(keywordResult('what carriers can plan ORD-1').wouldChangeData, false); // existing question guard
});

test('eval computes block and false-block rates from the runs', async () => {
  const cases = [
    { id: 'q1', label: 'question', text: 'tell me the carrier options to plan ORD-1' },
    { id: 'q2', label: 'question', text: 'curious if the carrier will accept SHP-1' },
    { id: 'c1', label: 'command', text: 'plan ORD-1' },
  ];
  let n = 0;
  const fake = async (state) => {
    n += 1;
    const isQ = /tell me|curious/.test(state.message);
    // q2 flips on its 2nd run → inconsistent
    const flipped = state.message.startsWith('curious') && n % 2 === 0;
    const noul = flipped ? 0.2 : (isQ ? 0.95 : 0.05);
    const choice = flipped ? 'record_carrier_response' : (isQ ? 'rate_quote' : 'plan');
    return { model: 'jev-1.13.0', latencyMs: 100 + n, usage: { input_tokens: 400 }, answers: { is_question: { noul }, intent: { choice, confidence: 0.9 } } };
  };
  const { summary: s } = await runEval(cases, { runs: 2, concurrency: 1, systemOne: fake });
  assert.equal(s.calls, 6);
  assert.equal(s.questions.keywordWouldChangeData, 2);
  assert.equal(s.questions.runsOnThose, 4);
  assert.equal(s.questions.runsBlocked, 3);
  assert.equal(s.commands.runsFalselyBlocked, 0);
  assert.deepEqual(s.inconsistentCases, ['q2']);
  assert.equal(s.tokens.avgPerCall, 400);
  assert.equal(s.costUsd.per1000Messages, 0.0168);
});

test('eval counts errors against the gate, not out of the denominator', async () => {
  const cases = [
    { id: 'q1', label: 'question', text: 'tell me the carrier options to plan ORD-1' },
    { id: 'c1', label: 'command', text: 'plan ORD-1' },
  ];
  let n = 0;
  const flaky = async () => {
    n += 1;
    if (n % 2 === 0) { const e = new Error('timed out'); e.status = 408; throw e; }
    return { model: 'm', latencyMs: 100, usage: { input_tokens: 10 }, answers: { is_question: { noul: 0.95 }, intent: { choice: 'rate_quote', confidence: 0.9 } } };
  };
  const { summary: s } = await runEval(cases, { runs: 2, concurrency: 1, systemOne: flaky });
  assert.equal(s.errors, 2);
  assert.equal(s.timeouts, 2);
  assert.equal(s.questions.runsOnThose, 2);        // errored run stays in the denominator
  assert.equal(s.questions.runsBlocked, 1);
  assert.equal(s.questions.blockRatePct, 50);
  assert.equal(s.questions.runsErrored, 1);
  assert.deepEqual(s.inconsistentCases.sort(), ['c1', 'q1']); // ok/error counts as inconsistent
});

test('eval defaults to the production timeout and rejects duplicate ids', async () => {
  let seen;
  await withEnv({ JEV_TIMEOUT_MS: '1500' }, async () => {
    const { summary } = await runEval([{ id: 'c1', label: 'command', text: 'plan ORD-1' }],
      { runs: 1, systemOne: async (_s, _q, o) => { seen = o.config.timeoutMs; return { answers: {} }; } });
    assert.equal(summary.timeoutMs, 1500);
  });
  assert.equal(seen, 1500);
  await assert.rejects(runEval([{ id: 'x', label: 'command', text: 'a' }, { id: 'x', label: 'command', text: 'b' }], { systemOne: async () => ({}) }), /duplicate case ids: x/);
});

test('clear/reset are not counted as gated commands', async () => {
  const { summary: s } = await runEval([{ id: 'c1', label: 'command', text: 'clear' }],
    { runs: 1, systemOne: async () => ({ answers: {} }) });
  assert.equal(s.commands.reachingGate, 0);
});

// ── review findings ───────────────────────────────────────────────
test('"clear?" and a vetoed clear fall back to help, never a wipe', async () => {
  const { readOnlyCommand, parseTypedCommand } = require('../services/teamsBot/handlers');
  assert.equal(parseTypedCommand('clear?').cmd, 'help');
  assert.equal(parseTypedCommand('reset?').cmd, 'help');
  assert.equal(parseTypedCommand('Clear the chat?').cmd, 'help');
  assert.equal(readOnlyCommand('clear').cmd, 'help');
  assert.equal(parseTypedCommand('clear').cmd, 'clear'); // explicit command still works
  await withEnv({ TYPESAFE_API_KEY: undefined, JEV_API_KEY: undefined }, async () => {
    const r = await handleActivity(typed('clear?'));
    assert.notEqual(r.type, 'clearConversation');
  });
});

test('status surfaces misconfiguration instead of silently degrading', async () => {
  await withEnv({ TYPESAFE_API_KEY: undefined, JEV_API_KEY: undefined, JEV_MODE: 'enforce' }, () => {
    const st = gate.status();
    assert.equal(st.mode, 'off');
    assert.ok(st.warnings.some((w) => /TYPESAFE_API_KEY is not set/.test(w)));
  });
  await withEnv({ TYPESAFE_API_KEY: 'sk-test', JEV_MODE: 'enforced', JEV_FAIL_MODE: 'shut' }, () => {
    const st = gate.status();
    assert.equal(st.mode, 'shadow');
    assert.ok(st.warnings.some((w) => /'enforced' is not recognised/.test(w)));
    assert.ok(st.warnings.some((w) => /'shut' is not recognised/.test(w)));
  });
  const { dryRunWarnings, isDryRun } = require('../services/teamsBot/dryRun');
  await withEnv({ TEAMS_BOT_DRY_RUN: '1' }, () => assert.equal(isDryRun(), true));
  await withEnv({ TEAMS_BOT_DRY_RUN: 'y' }, () => {
    assert.equal(isDryRun(), false);
    assert.equal(dryRunWarnings().length, 1);
  });
});

test('percentile', () => {
  assert.equal(percentile([1, 2, 3, 4], 50), 2);
  assert.equal(percentile([1, 2, 3, 4], 95), 4);
  assert.equal(percentile([], 50), null);
});
