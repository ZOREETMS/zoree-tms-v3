// ═══════════════════════════════════════════════════════════════════
// Agent autonomy policy — one table-driven tier per action type
// (docs/agentic-architecture-plan.md P0.4).
//
//   confirm   — proposed; a person approves before it executes (default)
//   auto      — executes as soon as the agent proposes it
//   forbidden — the agent may not propose it at all
//
// Every action ships as `confirm`. A tier is raised per action with an
// env var once the action has earned trust, e.g.
//   AGENT_POLICY_SEND_CHECK_CALL=auto
// Unknown values fall back to `confirm`, never to `auto`.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const { ACTION_TYPES } = require('./agentCatalog');

const TIERS = Object.freeze({ CONFIRM: 'confirm', AUTO: 'auto', FORBIDDEN: 'forbidden' });
const VALID = new Set(Object.values(TIERS));

const DEFAULT_TIERS = Object.freeze(
  Object.fromEntries(Object.keys(ACTION_TYPES).map((t) => [t, TIERS.CONFIRM]))
);

/** @param {string} actionType @param {object} [env=process.env] */
function tierFor(actionType, env = process.env) {
  const override = String(env[`AGENT_POLICY_${actionType}`] || '').trim().toLowerCase();
  if (VALID.has(override)) return override;
  return DEFAULT_TIERS[actionType] || TIERS.CONFIRM;
}

/** Snapshot of every action's effective tier (for the console). */
function policySnapshot(env = process.env) {
  return Object.fromEntries(Object.keys(ACTION_TYPES).map((t) => [t, tierFor(t, env)]));
}

module.exports = { TIERS, tierFor, policySnapshot };
