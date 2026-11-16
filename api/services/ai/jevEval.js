// ═══════════════════════════════════════════════════════════════════
// Jev intent-gate evaluation — measure, don't assume.
//
// Runs every labeled case through (a) the Teams keyword parser and
// (b) Jev + the veto policy, N times each, and reports:
//   • baseline risk   — questions the keyword parser would turn into a
//                       data change (mutating command WITH an id)
//   • protection      — of those, how many Jev calls vetoed
//   • false blocks    — real commands Jev vetoed (the cost of the gate)
//   • consistency     — cases whose decision differed between runs
//   • latency p50/p95/max, input tokens, cost at the published price
//
// Counting rules (so the numbers can't flatter the gate):
//   • Default timeout = the production JEV_TIMEOUT_MS, not a generous one.
//   • Rates are over ALL runs. An errored run counts as "not blocked",
//     which is what fail-open (the default) does in production. Errors are
//     also reported per group.
//   • Consistency treats an error as its own outcome (ok/error/ok = inconsistent).
//   • clear/reset are excluded from the command set (not TMS data).
//   • Cost = input tokens × published price (output is free); retries
//     inside a call are not visible to us.
//
// Only Jev is called. No TMS endpoint, no database, no carrier email.
// The CLI wrapper is scripts/jevEval.js.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const jev = require('./jevClient');
const { BOT_QUESTIONS, buildState, decide, getVetoThreshold } = require('./intentGate');
const { parseTypedCommand, MUTATING_WORDS } = require('../teamsBot/handlers');

const NON_DATA = new Set(['clear', 'reset']);
const DEFAULT_PRICE_PER_MTOK = 0.042; // TypeSafe published input price, USD

function keywordResult(text) {
  const parsed = parseTypedCommand(text);
  const mutating = MUTATING_WORDS.has(parsed.cmd);
  return {
    cmd: parsed.cmd,
    arg1: parsed.arg1,
    mutating,
    // Would actually change TMS data: mutating verb AND an id to act on.
    wouldChangeData: mutating && !NON_DATA.has(parsed.cmd) && Boolean(parsed.arg1),
  };
}

async function runOnce(text, isMutating, { systemOne, vetoThreshold, timeoutMs }) {
  try {
    const r = await systemOne(buildState(text), BOT_QUESTIONS, { config: { timeoutMs } });
    const d = decide({ isMutating, answers: r.answers, vetoThreshold });
    const a = r.answers || {};
    return {
      ok: true,
      veto: d.veto,
      intent: a.intent ? a.intent.choice : null,
      confidence: a.intent ? a.intent.confidence : null,
      pQuestion: a.is_question ? a.is_question.noul : null,
      latencyMs: r.latencyMs,
      inputTokens: r.usage ? r.usage.input_tokens : null,
      model: r.model || null,
    };
  } catch (err) {
    return { ok: false, error: err.message, status: err.status };
  }
}

// Small promise pool — keeps us well under the 1,200 req/min limit.
async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return out;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function pct(n, d) {
  return d ? Math.round((1000 * n) / d) / 10 : null;
}

function summarize(results, meta) {
  const calls = results.flatMap((c) => c.runs);
  const okCalls = calls.filter((r) => r.ok);
  const lat = okCalls.map((r) => r.latencyMs).filter((x) => typeof x === 'number').sort((a, b) => a - b);
  const tokens = okCalls.map((r) => r.inputTokens).filter((x) => typeof x === 'number');
  const totalTokens = tokens.reduce((a, b) => a + b, 0);

  const questions = results.filter((c) => c.label === 'question');
  const riskyQuestions = questions.filter((c) => c.keyword.wouldChangeData);
  const riskyRuns = riskyQuestions.flatMap((c) => c.runs);
  const blocked = (r) => r.ok && r.veto;

  const commands = results.filter((c) => c.label === 'command');
  const gatedCommands = commands.filter((c) => c.keyword.mutating && !NON_DATA.has(c.keyword.cmd));
  const commandRuns = gatedCommands.flatMap((c) => c.runs);

  const outcome = (r) => (r.ok ? (r.veto ? 'veto' : 'allow') : 'error');
  const inconsistent = results.filter((c) => new Set(c.runs.map(outcome)).size > 1);
  const timeouts = calls.filter((r) => !r.ok && r.status === 408).length;

  return {
    ...meta,
    cases: results.length,
    calls: calls.length,
    errors: calls.length - okCalls.length,
    models: [...new Set(okCalls.map((r) => r.model).filter(Boolean))],
    questions: {
      total: questions.length,
      keywordWouldChangeData: riskyQuestions.length,
      runsOnThose: riskyRuns.length,
      runsBlocked: riskyRuns.filter(blocked).length,
      runsErrored: riskyRuns.filter((r) => !r.ok).length,
      blockRatePct: pct(riskyRuns.filter(blocked).length, riskyRuns.length),
      casesBlockedEveryRun: riskyQuestions.filter((c) => c.runs.every(blocked)).length,
    },
    commands: {
      total: commands.length,
      reachingGate: gatedCommands.length,
      runsOnThose: commandRuns.length,
      runsFalselyBlocked: commandRuns.filter(blocked).length,
      runsErrored: commandRuns.filter((r) => !r.ok).length,
      falseBlockRatePct: pct(commandRuns.filter(blocked).length, commandRuns.length),
    },
    timeouts,
    inconsistentCases: inconsistent.map((c) => c.id),
    latencyMs: { p50: percentile(lat, 50), p95: percentile(lat, 95), max: lat.length ? lat[lat.length - 1] : null },
    tokens: {
      total: totalTokens,
      avgPerCall: tokens.length ? Math.round(totalTokens / tokens.length) : null,
    },
    costUsd: {
      total: +(totalTokens * meta.pricePerMTok / 1e6).toFixed(6),
      per1000Messages: tokens.length ? +((totalTokens / tokens.length) * 1000 * meta.pricePerMTok / 1e6).toFixed(4) : null,
    },
  };
}

/**
 * @param {Array<{id,label,text}>} cases
 * @param {{ runs?: number, concurrency?: number, systemOne?: Function, timeoutMs?: number }} [opts]
 */
async function runEval(cases, opts = {}) {
  const ids = cases.map((c) => c.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) throw new Error(`duplicate case ids: ${[...new Set(dupes)].join(', ')}`);

  const runs = opts.runs || 3;
  const vetoThreshold = getVetoThreshold();
  const timeoutMs = opts.timeoutMs || jev.getConfig().timeoutMs; // production value by default
  const ctx = { systemOne: opts.systemOne || jev.systemOne, vetoThreshold, timeoutMs };
  const jobs = cases.flatMap((c) => Array.from({ length: runs }, (_, run) => ({ c, run })));
  const keyword = new Map(cases.map((c) => [c.id, keywordResult(c.text)]));

  const started = new Date();
  const outcomes = await mapPool(jobs, opts.concurrency || 4, ({ c }) =>
    runOnce(c.text, keyword.get(c.id).mutating, ctx));

  const results = cases.map((c) => ({
    ...c,
    keyword: keyword.get(c.id),
    runs: jobs.map((j, i) => (j.c.id === c.id ? outcomes[i] : null)).filter(Boolean),
  }));

  const summary = summarize(results, {
    startedAt: started.toISOString(),
    finishedAt: new Date().toISOString(),
    runsPerCase: runs,
    vetoThreshold,
    timeoutMs,
    modelConfigured: jev.getConfig().model,
    pricePerMTok: Number.parseFloat(process.env.JEV_PRICE_PER_MTOK) || DEFAULT_PRICE_PER_MTOK,
  });
  return { summary, results };
}

module.exports = { runEval, summarize, keywordResult, percentile };
