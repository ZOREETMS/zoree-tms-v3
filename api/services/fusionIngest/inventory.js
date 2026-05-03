// ═══════════════════════════════════════════════════════════════════
// Fusion Inventory Ingest Service — F2 (Fusion Inventory → TMS).
//
// Two entry points:
//   - ingestTransactions(batch)   F2a: material transactions
//   - ingestOnHand(batch)         F2b: on-hand snapshot
//
// Until the dedicated inventory_transactions / inventory_on_hand tables
// exist, both flows persist the validated batch to integration_event_log
// (one row per OIC instance) so a future migration can replay them into
// the real tables. This keeps the migration footprint of v1 minimal
// while still giving Fusion a place to deliver and ops a place to look.
//
// Both entry points are idempotent on (source, oic_instance_id) via the
// shared eventLog helper.
//
// Tenancy: per-Supabase-project (see api/services/supabase.js); no
// row-level tenant_id required. tenant_id in the payload is an audit tag
// only.
// ═══════════════════════════════════════════════════════════════════

const eventLog = require('./eventLog');

function ensureArray(name, val) {
  if (!Array.isArray(val)) {
    const e = new Error(`${name} must be an array`);
    e.status = 400;
    throw e;
  }
  return val;
}

function validateTransaction(t, idx) {
  const errs = [];
  if (!t.fusion_transaction_id) errs.push(`transactions[${idx}].fusion_transaction_id is required`);
  if (!t.location_id)           errs.push(`transactions[${idx}].location_id is required`);
  if (!t.fusion_item_id)        errs.push(`transactions[${idx}].fusion_item_id is required`);
  if (!Number.isFinite(Number(t.qty))) errs.push(`transactions[${idx}].qty must be numeric`);
  return errs;
}

function validateOnHandRow(r, idx) {
  const errs = [];
  if (!r.location_id)    errs.push(`rows[${idx}].location_id is required`);
  if (!r.fusion_item_id) errs.push(`rows[${idx}].fusion_item_id is required`);
  if (!Number.isFinite(Number(r.qty))) errs.push(`rows[${idx}].qty must be numeric`);
  return errs;
}

async function ingestTransactions(body) {
  if (!body || typeof body !== 'object') {
    const e = new Error('payload must be an object'); e.status = 400; throw e;
  }
  const transactions = ensureArray('transactions', body.transactions);

  const errs = [];
  transactions.forEach((t, i) => errs.push(...validateTransaction(t, i)));
  if (errs.length) { const e = new Error(`Validation failed: ${errs.join('; ')}`); e.status = 400; e.details = errs; throw e; }

  const log = await eventLog.start({
    instanceId: body.instance_id,
    objectType: 'inventory_txn',
    tenantId:   body.tenant_id || null,
    payload:    body,
  });
  if (log.alreadyProcessed) {
    return { logged: [], skipped: transactions.map((t) => t.fusion_transaction_id), reason: 'already_processed' };
  }

  // The real persistence to a typed inventory_transactions table is
  // tracked separately. v1 stops at the audit ledger so OIC has a
  // concrete contract to integrate against today.
  await eventLog.markProcessed(log.id, null);

  return {
    accepted: transactions.length,
    logged:   transactions.map((t) => t.fusion_transaction_id),
    eventLogId: log.id,
  };
}

async function ingestOnHand(body) {
  if (!body || typeof body !== 'object') { const e = new Error('payload must be an object'); e.status = 400; throw e; }
  if (!body.as_of)     { const e = new Error('as_of is required'); e.status = 400; throw e; }
  const rows = ensureArray('rows', body.rows);

  const errs = [];
  rows.forEach((r, i) => errs.push(...validateOnHandRow(r, i)));
  if (errs.length) { const e = new Error(`Validation failed: ${errs.join('; ')}`); e.status = 400; e.details = errs; throw e; }

  const log = await eventLog.start({
    instanceId: body.instance_id,
    objectType: 'on_hand_snapshot',
    tenantId:   body.tenant_id || null,
    payload:    body,
  });
  if (log.alreadyProcessed) {
    return { accepted: 0, skipped: rows.length, reason: 'already_processed' };
  }
  await eventLog.markProcessed(log.id, null);

  return {
    accepted: rows.length,
    asOf: body.as_of,
    eventLogId: log.id,
  };
}

module.exports = { ingestTransactions, ingestOnHand };
