// ═══════════════════════════════════════════════════════════════════
// invoice_intakes (migration 051) — the single writer.
// One row per PDF received, whatever happened to it.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const db = require('../supabase');

const TABLE = 'invoice_intakes';

async function record(row) {
  const nowIso = new Date().toISOString();
  const { data, error } = await db.getClient().from(TABLE)
    .insert({ ...row, created_at: nowIso, updated_at: nowIso })
    .select().single();
  if (error) {
    const hint = /does not exist|schema cache|PGRST205|42P01/i.test(error.message) ? ' — apply migration 051' : '';
    throw new Error(`[DB] ${TABLE} insert failed: ${error.message}${hint}`);
  }
  return data;
}

async function findCreatedByHash(sha256) {
  const rows = await db.dbSelect(TABLE, {
    select: 'id,invoice_id,file_name,created_at',
    filters: [['file_sha256', 'eq', sha256], ['status', 'eq', 'created']],
    order: { col: 'created_at', asc: false }, limit: 1,
  });
  return rows[0] || null;
}

/** Latest intakes first; `runId` narrows to the documents one agent run read (migration 056). */
async function listRecent(limit = 50, { runId = null } = {}) {
  return db.dbSelect(TABLE, {
    select: 'id,source,file_name,status,invoice_id,duplicate_of_invoice_id,invoice_number,carrier,shipment_ref,total,read_confidence,problems,read_warnings,outcome_reason,created_by,created_at,run_id,read_invoice_date:raw_extraction->>invoiceDate',
    filters: runId ? [['run_id', 'eq', runId]] : [],
    order: { col: 'created_at', asc: false }, limit: Math.min(Number(limit) || 50, 200),
  });
}

/** Hashes of PDFs already read to an outcome (a failed read is retried). */
async function processedHashes() {
  const rows = await db.dbSelect(TABLE, {
    select: 'file_sha256',
    filters: [['status', 'in', ['created', 'duplicate', 'needs_manual']]],
    limit: 5000,
  });
  return new Set(rows.map((r) => r.file_sha256));
}

/** Invoices read from email since `sinceIso`, oldest first. */
async function listEmailSince(sinceIso) {
  return db.dbSelect(TABLE, {
    select: 'id,file_name,status,invoice_id,invoice_number,carrier,shipment_ref,total,read_confidence,problems,outcome_reason,created_at',
    filters: [['source', 'eq', 'email'], ['created_at', 'gte', sinceIso]],
    order: { col: 'created_at', asc: true }, limit: 200,
  });
}

/** One intake row with everything the agent read (current domain only). */
async function getById(id) {
  const rows = await db.dbSelect(TABLE, { filters: [['id', 'eq', id]], limit: 1 });
  return rows[0] || null;
}

/** The intake that created `invoiceId` (current domain only), if any. */
async function findByInvoiceId(invoiceId) {
  const rows = await db.dbSelect(TABLE, {
    select: 'id,file_name,created_at',
    filters: [['invoice_id', 'eq', invoiceId], ['status', 'eq', 'created']],
    order: { col: 'created_at', asc: false }, limit: 1,
  });
  return rows[0] || null;
}

module.exports = { record, findCreatedByHash, listRecent, processedHashes, listEmailSince, getById, findByInvoiceId };
