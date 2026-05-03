// ═══════════════════════════════════════════════════════════════════
// Fusion ingest — integration_event_log helper.
//
// Single shared module for writing the audit ledger row that every
// inbound Fusion OIC call gets. The ledger is the idempotency surface
// (UNIQUE on (source, oic_instance_id)) and the replay surface for ops.
//
// Usage:
//   const log = await eventLog.start({ instanceId, objectType, externalId, tenantId, payload });
//   try { ... do work ... await eventLog.markProcessed(log.id, internalId); }
//   catch (err) { await eventLog.markFailed(log.id, err); throw err; }
//
// The start() call is idempotent: if the row already exists for this
// (source, oic_instance_id), we return { id, alreadyProcessed: true } so
// the caller can short-circuit without doing the work twice.
// ═══════════════════════════════════════════════════════════════════

const db = require('../supabase');

const SOURCE = 'fusion';

async function start({ instanceId, objectType, direction = 'inbound', externalId = null, tenantId = null, payload }) {
  const client = db.getClient();
  // Try insert first — UNIQUE (source, oic_instance_id) keeps duplicates out.
  const row = {
    source:          SOURCE,
    object_type:     objectType,
    direction,
    external_id:     externalId,
    oic_instance_id: instanceId || null,
    status:          'received',
    payload,
    tenant_id:       tenantId,
  };
  const { data, error } = await client.from('integration_event_log').insert(row).select().single();
  if (!error) return { id: data.id, alreadyProcessed: false };

  // Conflict: same (source, oic_instance_id) — look it up and return.
  // Postgres unique-violation code is 23505. supabase-js surfaces it as
  // error.code OR within error.message — match defensively.
  const isConflict = error.code === '23505' || /duplicate key/i.test(error.message || '');
  if (!isConflict || !instanceId) {
    throw new Error(`[integration_event_log] insert failed: ${error.message}`);
  }
  const { data: existing, error: lookupErr } = await client
    .from('integration_event_log')
    .select('id, status')
    .eq('source', SOURCE)
    .eq('oic_instance_id', instanceId)
    .limit(1)
    .single();
  if (lookupErr) throw new Error(`[integration_event_log] lookup after conflict failed: ${lookupErr.message}`);
  return {
    id: existing.id,
    alreadyProcessed: existing.status === 'processed' || existing.status === 'replayed',
  };
}

async function markProcessed(id, internalId) {
  if (!id) return;
  const client = db.getClient();
  const { error } = await client
    .from('integration_event_log')
    .update({ status: 'processed', internal_id: internalId || null, processed_at: new Date().toISOString(), error: null })
    .eq('id', id);
  if (error) console.error('[integration_event_log] markProcessed failed:', error.message);
}

async function markFailed(id, err) {
  if (!id) return;
  const client = db.getClient();
  const status = err && err.status && err.status >= 400 && err.status < 500 ? 'failed_4xx' : 'failed_5xx';
  const message = (err && err.message) || String(err || 'unknown');
  const { error } = await client
    .from('integration_event_log')
    .update({ status, error: message.slice(0, 2000), processed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) console.error('[integration_event_log] markFailed failed:', error.message);
}

module.exports = { start, markProcessed, markFailed, SOURCE };
