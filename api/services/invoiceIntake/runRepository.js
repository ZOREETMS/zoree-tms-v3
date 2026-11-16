// ═══════════════════════════════════════════════════════════════════
// invoice_intake_runs (migration 056) — the single writer.
// One row per invoice-agent run per client domain. Domain-scoped: reads
// and writes go through the scoped fetch, so call inside the run's domain.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const db = require('../supabase');

const TABLE = 'invoice_intake_runs';
const COLS = 'id,domain_code,trigger,channel,started_by,mailbox,status,emails_read,error,started_at,finished_at';

async function create(row) {
  const nowIso = new Date().toISOString();
  const { data, error } = await db.getClient().from(TABLE)
    .insert({ ...row, started_at: nowIso, created_at: nowIso, updated_at: nowIso })
    .select(COLS).single();
  if (error) {
    const hint = /does not exist|schema cache|PGRST205|42P01/i.test(error.message) ? ' — apply migration 056' : '';
    throw new Error(`[DB] ${TABLE} insert failed: ${error.message}${hint}`);
  }
  return data;
}

async function finish(id, patch) {
  const { error } = await db.getClient().from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`[DB] ${TABLE} update failed: ${error.message}`);
}

/** Latest runs first (current domain). */
async function list(limit = 50) {
  return db.dbSelect(TABLE, {
    select: COLS, order: { col: 'started_at', asc: false }, limit: Math.min(Number(limit) || 50, 200),
  });
}

async function get(id) {
  const rows = await db.dbSelect(TABLE, { select: COLS, filters: [['id', 'eq', id]], limit: 1 });
  return rows[0] || null;
}

async function byIds(ids) {
  if (!ids.length) return [];
  return db.dbSelect(TABLE, { select: COLS, filters: [['id', 'in', ids]], limit: ids.length });
}

/** The intakes each run produced, with their invoice's status (for outcome counts). */
async function intakesOf(runIds) {
  if (!runIds.length) return { intakes: [], invoices: [] };
  const intakes = await db.dbSelect('invoice_intakes', {
    select: 'id,run_id,status,invoice_id', filters: [['run_id', 'in', runIds]], limit: 5000,
  });
  const invIds = [...new Set(intakes.map((r) => r.invoice_id).filter(Boolean))];
  const invoices = invIds.length
    ? await db.dbSelect('invoices', { select: 'id,status', filters: [['id', 'in', invIds]], limit: invIds.length })
    : [];
  return { intakes, invoices };
}

module.exports = { create, finish, list, get, byIds, intakesOf };
