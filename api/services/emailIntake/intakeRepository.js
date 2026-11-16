// ═══════════════════════════════════════════════════════════════════
// Email order intake — repository (all reads/writes of
// email_order_intake, plus the order lookups the agent needs).
//
// Table: email_order_intake (migration 049). Status is controlled:
//   pending_review | created | rejected | not_order | error
//
// Split out of intakeService.js (2026-10-25, CLAUDE_RULES §1/§6).
// ═══════════════════════════════════════════════════════════════════

'use strict';

const db = require('../supabase');
const { clean } = require('./draftMapper');

const TABLE = 'email_order_intake';
const TENANT = process.env.DEFAULT_TENANT || 'zoree-default';
const STATUSES = Object.freeze(['pending_review', 'created', 'rejected', 'not_order', 'error']);

let _customers = { at: 0, list: [] };
async function knownCustomers() {
  if (Date.now() - _customers.at < 10 * 60 * 1000) return _customers.list;
  try {
    const rows = await db.dbSelect('orders', { select: 'customer', order: { col: 'created_at', asc: false }, limit: 3000 });
    const counts = new Map();
    for (const r of rows) {
      const c = clean(r.customer);
      if (!c || /test|probe|req\d|perf|^customer$/i.test(c)) continue;
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    _customers = { at: Date.now(), list: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 150).map(([c]) => c) };
  } catch (err) {
    console.error('[emailIntake] customer list failed:', err.message);
  }
  return _customers.list;
}

/** Orders that already carry one of these PO numbers → [{ po, orderId }]. */
async function duplicatePOs(drafts) {
  const pos = [...new Set(drafts.map((d) => clean(d.po_number)).filter(Boolean))];
  if (!pos.length) return [];
  const rows = await db.dbSelect('orders', { select: 'id,po_number', filters: [['po_number', 'in', pos]], limit: 50 });
  return rows.map((r) => ({ po: r.po_number, orderId: r.id }));
}

async function seenMessageIds(mailbox, ids) {
  if (!ids.length) return new Set();
  const rows = await db.dbSelect(TABLE, {
    select: 'message_id',
    // Any domain: a message read once is done, whichever domain it was routed to.
    // (The explicit domain_code filter stops the domain scope from narrowing this read.)
    filters: [['tenant_id', 'eq', TENANT], ['mailbox', 'eq', mailbox], ['message_id', 'in', ids], ['domain_code', 'ilike', '%']],
    limit: ids.length,
  });
  return new Set(rows.map((r) => r.message_id));
}

async function insertRow(row) {
  const client = db.getClient();
  const { data, error } = await client.from(TABLE).insert({ tenant_id: TENANT, ...row }).select();
  if (error) {
    if (error.code === '23505') return null; // already processed by a concurrent run
    throw new Error(`[DB] ${TABLE} insert failed: ${error.message}`);
  }
  return data[0];
}

async function updateRow(id, patch, expectStatus) {
  const client = db.getClient();
  let q = client.from(TABLE).update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).eq('tenant_id', TENANT);
  if (expectStatus) q = q.in('status', [].concat(expectStatus));
  const { data, error } = await q.select();
  if (error) throw new Error(`[DB] ${TABLE} update failed: ${error.message}`);
  return data && data[0];
}

async function getIntake(id) {
  const rows = await db.dbSelect(TABLE, { filters: [['id', 'eq', id], ['tenant_id', 'eq', TENANT]], limit: 1 });
  return rows[0] || null;
}

async function listIntake({ status, limit = 100 } = {}) {
  const filters = [['tenant_id', 'eq', TENANT]];
  if (status && status !== 'all') filters.push(['status', 'eq', status]);
  return db.dbSelect(TABLE, {
    select: 'id,source,mailbox,message_id,from_address,from_name,subject,received_at,attachment_names,status,is_order_confidence,extracted,missing_fields,error,model,reviewed_by,reviewed_at,created_at',
    filters,
    order: { col: 'received_at', asc: false },
    limit: Math.min(Number(limit) || 100, 500),
  });
}

async function statusCounts() {
  const out = {};
  for (const s of STATUSES) {
    out[s] = await db.dbCount(TABLE, { filters: [['tenant_id', 'eq', TENANT], ['status', 'eq', s]] });
  }
  return out;
}

module.exports = {
  TABLE, TENANT, STATUSES,
  knownCustomers, duplicatePOs, seenMessageIds,
  insertRow, updateRow, getIntake, listIntake, statusCounts,
};
