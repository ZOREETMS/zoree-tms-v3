// ═══════════════════════════════════════════════════════════════════
// invoice_intake_files (migration 053) — the single writer/reader.
// The original document for one invoice_intakes row, so AP can see the
// PDF next to the fields Zoree AI read from it.
//
// This table has no domain column: callers must load the parent intake
// row first (intakeRepository.getById is domain-scoped) and only then
// ask for its file.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const db = require('../supabase');

const TABLE = 'invoice_intake_files';
const MAX_BYTES = 7 * 1024 * 1024; // same cap as the PDF upload

async function save({ intakeId, fileName, buffer, tenantId = null, contentType = 'application/pdf' }) {
  if (!intakeId || !buffer || !buffer.length || buffer.length > MAX_BYTES) return false;
  const nowIso = new Date().toISOString();
  const { error } = await db.getClient().from(TABLE).upsert({
    intake_id: intakeId, file_name: fileName, content_type: contentType, size_bytes: buffer.length,
    content_base64: buffer.toString('base64'), tenant_id: tenantId, created_at: nowIso, updated_at: nowIso,
  }, { onConflict: 'intake_id' });
  if (error) throw new Error(`[DB] ${TABLE} save failed: ${error.message}`);
  return true;
}

async function exists(intakeId) {
  const rows = await db.dbSelect(TABLE, { select: 'intake_id', filters: [['intake_id', 'eq', intakeId]], limit: 1 });
  return rows.length > 0;
}

/** @returns {Promise<{fileName:string, contentType:string, buffer:Buffer}|null>} */
async function get(intakeId) {
  const rows = await db.dbSelect(TABLE, { filters: [['intake_id', 'eq', intakeId]], limit: 1 });
  const r = rows[0];
  return r ? { fileName: r.file_name, contentType: r.content_type, buffer: Buffer.from(r.content_base64, 'base64') } : null;
}

module.exports = { save, exists, get, MAX_BYTES };
