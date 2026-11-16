// ═══════════════════════════════════════════════════════════════════
// Agent runner — the shared loop for every back-office agent.
//
//   runAgent(key, input)      agent.plan(input) → proposed actions
//                             → auto-tier actions execute immediately
//   approveAction(id, edits)  claim → executor (existing service) → result
//   rejectAction(id, reason)
//
// Agents never write TMS tables directly. An agent module returns a
// plan ({ summary, actions[] }); executing an action calls the same
// single-writer services the UI uses, so REQ-02 history, patch guards
// and status gates apply unchanged.
//
// Agent module contract (services/agents/<agent>/index.js):
//   key            agent key from agentCatalog
//   validateInput  (input) → normalized input | throws 400
//   plan           (input, ctx) → { summary, entityType?, entityId?, findings?, actions[], model?, usage? }
//   executors      { [ACTION_TYPE]: async (payload, ctx) → result }
//   editableFields { [ACTION_TYPE]: ['field', …] }  fields an approver may change
//   snapshotInput  (input) → what to store in agent_runs.input (optional; e.g. drop file bytes)
// ═══════════════════════════════════════════════════════════════════

'use strict';

const store = require('./agentRunStore');
const { tierFor, TIERS } = require('./agentPolicies');
const { RUN_STATUS, ACTION_STATUS, TRIGGERS, assertAgent, assertActionType } = require('./agentCatalog');

const registry = new Map();

function registerAgent(mod) {
  assertAgent(mod.key);
  for (const type of Object.keys(mod.executors || {})) assertActionType(type);
  registry.set(mod.key, mod);
}

function getAgentModule(key) {
  assertAgent(key);
  const mod = registry.get(key);
  if (!mod) { const e = new Error(`Agent '${key}' is not registered`); e.status = 503; throw e; }
  return mod;
}

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

/** Stable key so the same proposal from two runs is stored once. */
function idempotencyKeyFor(agentKey, action) {
  return action.idempotencyKey || `${agentKey}:${action.type}:${action.entityId || 'none'}:${action.dedupe || ''}`;
}

/**
 * Drop forbidden actions; tag each with its approval requirement.
 * An agent may set `requireApproval: true` on an action to demand a person
 * (e.g. an AP limit or a change freeze); it can never lower the policy tier.
 */
function applyPolicy(agentKey, actions) {
  return actions
    .filter((a) => tierFor(a.type) !== TIERS.FORBIDDEN)
    .map((a) => {
      const { requireApproval, ...rest } = a;
      return { ...rest, idempotencyKey: idempotencyKeyFor(agentKey, a), requiresApproval: requireApproval === true || tierFor(a.type) !== TIERS.AUTO };
    });
}

async function refreshRunStatus(runId) {
  const actions = await store.listActionsForRun(runId);
  const open = actions.some((a) => a.status === ACTION_STATUS.PROPOSED || a.status === ACTION_STATUS.EXECUTING);
  return store.updateRun(runId, {
    status: open ? RUN_STATUS.AWAITING_APPROVAL : RUN_STATUS.COMPLETED,
    finished_at: open ? null : new Date().toISOString(),
  });
}

function buildCtx({ user, run, action }) {
  return {
    user,
    run,
    action,
    // Stamped into notes / metadata so every TMS change links back here.
    trace: { agent: run && run.agent, agent_run_id: run && run.id, agent_action_id: action && action.id },
  };
}

async function execute(action, run, user) {
  const mod = getAgentModule(run.agent);
  const exec = mod.executors[action.action_type];
  if (!exec) throw httpError(500, `No executor for ${action.action_type}`);
  try {
    const result = await exec(action.payload || {}, buildCtx({ user, run, action }));
    return store.transitionAction(action.id, ACTION_STATUS.EXECUTING, {
      status: ACTION_STATUS.EXECUTED, executed_at: new Date().toISOString(), result: result || {}, error: null,
    });
  } catch (err) {
    await store.transitionAction(action.id, ACTION_STATUS.EXECUTING, { status: ACTION_STATUS.FAILED, error: err.message });
    throw err;
  }
}

/**
 * Run one agent. Returns the stored run with its actions.
 * @param {string} agentKey
 * @param {object} rawInput
 * @param {{user:object, trigger?:string}} opts
 */
async function runAgent(agentKey, rawInput, { user, trigger = 'manual' } = {}) {
  const mod = getAgentModule(agentKey);
  if (!TRIGGERS.includes(trigger)) throw httpError(400, `Invalid trigger '${trigger}'`);
  const input = mod.validateInput(rawInput || {});
  const stored = mod.snapshotInput ? mod.snapshotInput(input) : input;
  const run = await store.createRun({ agent: agentKey, trigger, input: stored, user });

  let plan;
  try {
    plan = await mod.plan(input, buildCtx({ user, run }));
  } catch (err) {
    await store.updateRun(run.id, { status: RUN_STATUS.FAILED, error: err.message, finished_at: new Date().toISOString() });
    if (err.status && err.status < 500) throw err;
    return store.getRun(run.id);
  }

  await store.updateRun(run.id, {
    summary: plan.summary || null,
    entity_type: plan.entityType || null,
    entity_id: plan.entityId || null,
    model: plan.model || null,
    input_tokens: (plan.usage && plan.usage.input_tokens) || null,
    output_tokens: (plan.usage && plan.usage.output_tokens) || null,
    // Findings are evidence for the reviewer — kept with the input snapshot.
    input: { ...stored, ...(plan.findings ? { _findings: plan.findings } : {}) },
  });

  const { inserted } = await store.insertActions(run.id, applyPolicy(agentKey, plan.actions || []));
  for (const a of inserted.filter((x) => !x.requires_approval)) {
    // eslint-disable-next-line no-await-in-loop
    const claimed = await store.transitionAction(a.id, ACTION_STATUS.PROPOSED, { status: ACTION_STATUS.EXECUTING, decided_by: 'policy:auto', decided_at: new Date().toISOString() });
    // eslint-disable-next-line no-await-in-loop
    if (claimed) await execute(claimed, run, user).catch((err) => console.error(`[agents] auto ${a.action_type} failed:`, err.message));
  }
  await refreshRunStatus(run.id);
  return store.getRun(run.id);
}

/** Keep only the fields the agent declared editable for this action type. */
function mergeEdits(mod, action, edits) {
  if (!edits || typeof edits !== 'object') return action.payload || {};
  const allowed = (mod.editableFields && mod.editableFields[action.action_type]) || [];
  const patch = {};
  for (const f of allowed) if (edits[f] !== undefined) patch[f] = edits[f];
  return { ...(action.payload || {}), ...patch, ...(Object.keys(patch).length ? { _edited: Object.keys(patch) } : {}) };
}

async function approveAction(actionId, { user, edits } = {}) {
  const action = await store.getAction(actionId);
  if (!action) throw httpError(404, 'Action not found');
  if (action.status !== ACTION_STATUS.PROPOSED) throw httpError(409, `Action is '${action.status}', only proposed actions can be approved`);
  const run = await store.getRun(action.run_id, { withActions: false });
  const mod = getAgentModule(run.agent);

  const claimed = await store.transitionAction(actionId, ACTION_STATUS.PROPOSED, {
    status: ACTION_STATUS.EXECUTING,
    payload: mergeEdits(mod, action, edits),
    decided_by: store.actorOf(user),
    decided_at: new Date().toISOString(),
  });
  if (!claimed) throw httpError(409, 'Action was already handled by someone else');

  try {
    return await execute(claimed, run, user);
  } finally {
    await refreshRunStatus(run.id);
  }
}

async function rejectAction(actionId, { user, reason } = {}) {
  const row = await store.transitionAction(actionId, ACTION_STATUS.PROPOSED, {
    status: ACTION_STATUS.REJECTED,
    decided_by: store.actorOf(user),
    decided_at: new Date().toISOString(),
    error: reason ? `Rejected: ${reason}` : null,
  });
  if (!row) throw httpError(409, 'Only proposed actions can be rejected');
  await refreshRunStatus(row.run_id);
  return row;
}

module.exports = {
  registerAgent, getAgentModule, runAgent, approveAction, rejectAction,
  // exported for tests
  applyPolicy, mergeEdits, idempotencyKeyFor,
};
