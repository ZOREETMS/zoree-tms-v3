// ═══════════════════════════════════════════════════════════════════
// Agent run store — the only reader/writer of agent_runs and
// agent_actions (migration 050).
// ═══════════════════════════════════════════════════════════════════

'use strict';

const db = require('../supabase');
const { RUN_STATUS, ACTION_STATUS } = require('./agentCatalog');

const RUNS = 'agent_runs';
const ACTIONS = 'agent_actions';
const TENANT = process.env.DEFAULT_TENANT || 'zoree-default';
const MAX_TEXT = 2000;

const actorOf = (user) => (user && (user.email || user.id)) || 'system';
const clip = (s) => (s == null ? null : String(s).slice(0, MAX_TEXT));

function dbError(table, op, error) {
  return new Error(`[DB] ${table} ${op} failed: ${error.message}`);
}

async function createRun({ agent, trigger = 'manual', input = null, entityType = null, entityId = null, user }) {
  const { data, error } = await db.getClient().from(RUNS).insert({
    tenant_id: TENANT, agent, trigger, status: RUN_STATUS.RUNNING,
    input, entity_type: entityType, entity_id: entityId, created_by: actorOf(user),
  }).select();
  if (error) throw dbError(RUNS, 'insert', error);
  return data[0];
}

async function updateRun(id, patch) {
  const { data, error } = await db.getClient().from(RUNS)
    .update({ ...patch, summary: patch.summary !== undefined ? clip(patch.summary) : undefined, error: patch.error !== undefined ? clip(patch.error) : undefined })
    .eq('id', id).eq('tenant_id', TENANT).select();
  if (error) throw dbError(RUNS, 'update', error);
  return data && data[0];
}

/**
 * Insert proposed actions. A duplicate idempotency_key (same action
 * already proposed by an earlier run) is skipped, not re-proposed.
 * @returns {Promise<{inserted: object[], duplicates: string[]}>}
 */
async function insertActions(runId, actions) {
  const inserted = [];
  const duplicates = [];
  for (const a of actions) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await db.getClient().from(ACTIONS).insert({
      run_id: runId, tenant_id: TENANT,
      action_type: a.type, entity_type: a.entityType || null, entity_id: a.entityId || null,
      title: String(a.title || a.type).slice(0, 300), payload: a.payload || {},
      status: ACTION_STATUS.PROPOSED, requires_approval: a.requiresApproval !== false,
      idempotency_key: a.idempotencyKey,
    }).select();
    if (error && error.code === '23505') { duplicates.push(a.idempotencyKey); continue; }
    if (error) throw dbError(ACTIONS, 'insert', error);
    inserted.push(data[0]);
  }
  return { inserted, duplicates };
}

async function getAction(id) {
  const rows = await db.dbSelect(ACTIONS, { filters: [['id', 'eq', id], ['tenant_id', 'eq', TENANT]], limit: 1 });
  return rows[0] || null;
}

/** Move an action from one status to another only if it is still in `from` (atomic claim). */
async function transitionAction(id, from, patch) {
  const { data, error } = await db.getClient().from(ACTIONS)
    .update({ ...patch, error: patch.error !== undefined ? clip(patch.error) : undefined })
    .eq('id', id).eq('tenant_id', TENANT).in('status', [].concat(from)).select();
  if (error) throw dbError(ACTIONS, 'update', error);
  return (data && data[0]) || null;
}

async function listActionsForRun(runId) {
  return db.dbSelect(ACTIONS, { filters: [['run_id', 'eq', runId]], order: { col: 'created_at', asc: true }, limit: 200 });
}

async function getRun(id, { withActions = true } = {}) {
  const rows = await db.dbSelect(RUNS, { filters: [['id', 'eq', id], ['tenant_id', 'eq', TENANT]], limit: 1 });
  const run = rows[0] || null;
  if (run && withActions) run.actions = await listActionsForRun(id);
  return run;
}

async function listRuns({ agent, limit = 20 } = {}) {
  const filters = [['tenant_id', 'eq', TENANT]];
  if (agent) filters.push(['agent', 'eq', agent]);
  const runs = await db.dbSelect(RUNS, { filters, order: { col: 'started_at', asc: false }, limit: Math.min(Number(limit) || 20, 100) });
  if (!runs.length) return runs;
  const actions = await db.dbSelect(ACTIONS, { filters: [['run_id', 'in', runs.map((r) => r.id)]], order: { col: 'created_at', asc: true }, limit: 1000 });
  const byRun = new Map();
  for (const a of actions) { if (!byRun.has(a.run_id)) byRun.set(a.run_id, []); byRun.get(a.run_id).push(a); }
  return runs.map((r) => ({ ...r, actions: byRun.get(r.id) || [] }));
}

/** Pending approvals per agent, for the console badges. */
async function pendingCounts() {
  const rows = await db.dbSelect(ACTIONS, {
    select: 'run_id', filters: [['tenant_id', 'eq', TENANT], ['status', 'eq', ACTION_STATUS.PROPOSED]], limit: 2000,
  });
  if (!rows.length) return {};
  const runIds = [...new Set(rows.map((r) => r.run_id))];
  const runs = await db.dbSelect(RUNS, { select: 'id,agent', filters: [['id', 'in', runIds]], limit: runIds.length });
  const agentOf = new Map(runs.map((r) => [r.id, r.agent]));
  const out = {};
  for (const r of rows) { const a = agentOf.get(r.run_id); if (a) out[a] = (out[a] || 0) + 1; }
  return out;
}

module.exports = {
  TENANT, actorOf,
  createRun, updateRun, insertActions, getAction, transitionAction, listActionsForRun, getRun, listRuns, pendingCounts,
};
