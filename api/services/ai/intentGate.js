// ═══════════════════════════════════════════════════════════════════
// Jev intent gate for chat channels (Teams bot today; web chatbot and
// voice later).
//
// Why: the Teams dispatcher is a keyword scan. On 2026-08-09 the question
// "what are different carrier options available to plan ORD-X" hit the
// `plan` verb and created a shipment. QUESTION_STARTERS patched that one
// phrasing; this gate asks Jev whether the message is a question or a
// change request before any mutating command runs.
//
// Safety contract — Jev can only VETO, never initiate:
//   • The regex dispatcher still picks the command. Jev never chooses a
//     mutation on its own, so a crafted message can at worst downgrade an
//     action to a read-only lookup (the message text is untrusted state).
//   • Read-only commands are never blocked.
//   • If Jev errors or times out, JEV_FAIL_MODE decides (below).
//   • Scope: typed Teams messages only. Card button clicks, the web UI,
//     the web chatbot and the REST API do not pass through this gate.
//
// Modes (JEV_MODE in api/.env):
//   off      no calls
//   shadow   (default once TYPESAFE_API_KEY is set) call Jev in the
//            background, log to jev-decisions.log, never change behaviour
//   enforce  await Jev for mutating commands; veto when it is confident
//            the message is a question / read-only request
// JEV_VETO_THRESHOLD (default 0.7) is the confidence needed to veto.
//
// JEV_FAIL_MODE (enforce only) — what happens when Jev errors or times out:
//   open    (default) regex result stands — today's behaviour, including
//           any keyword misfire. A known limitation, not a safety feature.
//   closed  only a bare command ("plan ORD-1", verb first) may change
//           data; any other phrasing is downgraded to the read-only
//           lookup until Jev is reachable again.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const jev = require('./jevClient');
const { choice, noul } = require('./jevQuestions');
const { logDecision } = require('./jevDecisionLog');

const MODES = new Set(['off', 'shadow', 'enforce']);
const DEFAULT_VETO_THRESHOLD = 0.7;

// Intents that never change data. `other` is excluded on purpose: "not
// sure" must not be enough to block a command the user typed explicitly.
const READ_ONLY_INTENTS = new Set(['status_lookup', 'rate_quote', 'list', 'help']);

// Regex command word → intent family, for agreement stats in the log.
const CMD_TO_INTENT = Object.freeze({
  today: 'list', summary: 'list', orders: 'list', shipments: 'list',
  order: 'status_lookup', shipment: 'status_lookup', track: 'status_lookup',
  rate: 'rate_quote', quote: 'rate_quote',
  plan: 'plan', unplan: 'unplan', unassign: 'unplan',
  tender: 'tender', withdraw: 'withdraw',
  accept: 'record_carrier_response', reject: 'record_carrier_response',
  intransit: 'update_status', transit: 'update_status', pickup: 'update_status',
  delivered: 'update_status', deliver: 'update_status',
  clear: 'clear_chat', reset: 'clear_chat',
  help: 'help', hi: 'help', hello: 'help',
});

const BOT_QUESTIONS = Object.freeze({
  intent: choice('What the user wants the TMS bot to do with this message', {
    status_lookup: 'Look up, track, or ask about the details of an order or shipment',
    rate_quote: 'Ask which carriers, rates, quotes, options or costs are available for an order',
    list: 'List orders or shipments, or get a daily summary',
    plan: 'Plan an order onto a shipment now',
    unplan: 'Remove an order from its shipment',
    tender: 'Send a shipment tender to a carrier now',
    record_carrier_response: 'Record that a carrier accepted or rejected a tender',
    withdraw: 'Withdraw a tender that was already sent',
    update_status: 'Mark a shipment as picked up, in transit, or delivered',
    clear_chat: 'Delete the bot messages in this chat',
    help: 'Ask how the bot works or which commands exist',
    other: 'Anything else, or the request is unclear',
  }),
  is_question: noul(
    'The message only asks for information and does not ask the bot to change any data',
    {
      true: 'A question or information request, e.g. "what carriers can plan ORD-1?"',
      false: 'A request to perform an action, including polite requests such as "can you plan ORD-1"',
    },
  ),
});

// Only the fields the questions need — Jev accuracy drops with padding.
function buildState(text) {
  return {
    app: 'Freight TMS chat bot. IDs starting ORD- are orders, SHP- are shipments.',
    message: String(text || ''),
  };
}

function getMode() {
  if (!jev.isConfigured()) return 'off';
  const raw = String(process.env.JEV_MODE || 'shadow').trim().toLowerCase();
  return MODES.has(raw) ? raw : 'shadow';
}

function getFailMode() {
  return String(process.env.JEV_FAIL_MODE || 'open').trim().toLowerCase() === 'closed' ? 'closed' : 'open';
}

// "plan ORD-1" / "Plan ORD-1 XPO": the command word is the first token.
function isBareCommand(text, regexCmd) {
  const first = String(text || '').trim().split(/\s+/)[0] || '';
  return Boolean(regexCmd) && first.toLowerCase().replace(/[,.:!?#]/g, '') === regexCmd;
}

/**
 * Pure policy for when Jev could not answer (enforce mode only).
 * @returns {{ veto: boolean, kind?: string, reason: string }}
 */
function decideOnUnavailable({ text, regexCmd, isMutating, failMode, error }) {
  const why = error ? ` (${error})` : '';
  if (!isMutating) return { veto: false, reason: `jev unavailable${why}; read-only command` };
  if (failMode === 'closed' && !isBareCommand(text, regexCmd)) {
    return { veto: true, kind: 'unavailable', reason: `jev unavailable${why}; fail-closed on non-bare phrasing` };
  }
  return { veto: false, reason: `jev unavailable${why}; regex result stands (fail-${failMode})` };
}

// Everything an operator needs to confirm the gate is really on — enforce
// silently becomes 'off' without a key and 'shadow' on a typo.
function status() {
  const requested = String(process.env.JEV_MODE || 'shadow').trim().toLowerCase();
  const failRaw = String(process.env.JEV_FAIL_MODE || 'open').trim().toLowerCase();
  const warnings = [];
  if (!jev.isConfigured() && requested !== 'off') warnings.push(`JEV_MODE=${requested} but TYPESAFE_API_KEY is not set — gate is OFF`);
  if (!MODES.has(requested)) warnings.push(`JEV_MODE='${requested}' is not recognised — running as shadow`);
  if (!['open', 'closed'].includes(failRaw)) warnings.push(`JEV_FAIL_MODE='${failRaw}' is not recognised — running fail-open`);
  return {
    jevConfigured: jev.isConfigured(),
    mode: getMode(),
    requestedMode: requested,
    failMode: getFailMode(),
    vetoThreshold: getVetoThreshold(),
    model: jev.getConfig().model,
    timeoutMs: jev.getConfig().timeoutMs,
    warnings,
  };
}

function getVetoThreshold() {
  const n = Number.parseFloat(process.env.JEV_VETO_THRESHOLD);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : DEFAULT_VETO_THRESHOLD;
}

/**
 * Pure policy — no I/O. Decides whether Jev's answers veto the regex command.
 * @returns {{ veto: boolean, reason: string }}
 */
function decide({ isMutating, answers, vetoThreshold = DEFAULT_VETO_THRESHOLD }) {
  if (!isMutating) return { veto: false, reason: 'read-only command' };
  const a = answers || {};
  const pQuestion = a.is_question && typeof a.is_question.noul === 'number' ? a.is_question.noul : 0;
  if (pQuestion >= vetoThreshold) {
    return { veto: true, kind: 'question', reason: `jev: question (p=${pQuestion.toFixed(2)})` };
  }
  const intent = a.intent || {};
  const confidence = typeof intent.confidence === 'number' ? intent.confidence : 0;
  if (READ_ONLY_INTENTS.has(intent.choice) && confidence >= vetoThreshold) {
    return { veto: true, kind: 'question', reason: `jev: read-only intent ${intent.choice} (c=${confidence.toFixed(2)})` };
  }
  return { veto: false, reason: 'jev: action request' };
}

function summarizeAnswers(answers) {
  const a = answers || {};
  return {
    intent: a.intent ? a.intent.choice : null,
    intentConfidence: a.intent ? a.intent.confidence : null,
    intentProbabilities: a.intent ? a.intent.probabilities : null,
    pQuestion: a.is_question ? a.is_question.noul : null,
  };
}

async function classifyAndLog({ text, regexCmd, isMutating, mode, channel, opts }) {
  const vetoThreshold = getVetoThreshold();
  try {
    const result = await jev.systemOne(buildState(text), BOT_QUESTIONS, opts);
    const decision = decide({ isMutating, answers: result.answers, vetoThreshold });
    const summary = summarizeAnswers(result.answers);
    logDecision({
      channel, mode, text, regexCmd, isMutating,
      regexIntent: CMD_TO_INTENT[regexCmd] || 'other',
      agrees: (CMD_TO_INTENT[regexCmd] || 'other') === summary.intent,
      ...summary,
      veto: decision.veto,
      applied: mode === 'enforce' && decision.veto,
      reason: decision.reason,
      model: result.model,
      latencyMs: result.latencyMs,
      usage: result.usage,
    });
    return decision;
  } catch (err) {
    logDecision({ channel, mode, text, regexCmd, isMutating, error: err.message, status: err.status });
    throw err;
  }
}

/**
 * Review a command the regex dispatcher already chose.
 * @param {{ text: string, regexCmd: string, isMutating: boolean, channel?: string, opts?: object }} input
 * @returns {Promise<{ mode: string, veto: boolean, reason?: string }>}
 */
async function review({ text, regexCmd, isMutating, channel = 'teams', opts }) {
  const mode = getMode();
  if (mode === 'off') return { mode, veto: false };

  const args = { text, regexCmd, isMutating, mode, channel, opts };

  // Shadow mode, and read-only commands in enforce mode: never add latency.
  if (mode === 'shadow' || !isMutating) {
    classifyAndLog(args).catch(() => {});
    return { mode, veto: false };
  }

  try {
    const decision = await classifyAndLog(args);
    return { mode, ...decision };
  } catch (err) {
    const decision = decideOnUnavailable({
      text, regexCmd, isMutating, failMode: getFailMode(), error: err.message,
    });
    if (decision.veto) logDecision({ channel, mode, text, regexCmd, isMutating, veto: true, applied: true, reason: decision.reason });
    return { mode, ...decision };
  }
}

module.exports = {
  review, decide, decideOnUnavailable, isBareCommand, getFailMode, status,
  getMode, getVetoThreshold, buildState,
  BOT_QUESTIONS, CMD_TO_INTENT, READ_ONLY_INTENTS,
};
