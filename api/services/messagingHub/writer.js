// ═══════════════════════════════════════════════════════════════════
// Messaging Hub — single writer.
//
// Every message that lands in `message_log` MUST go through this
// module.  This is the single-writer guarantee (CLAUDE_RULES §10 — no
// shortcuts, no skipping services layer; zoree_db_rules.pdf §Data
// Integrity 2 — avoid duplicate sources of truth).
//
// API:
//   recordInbound  ({ messageType, source, target, payload, headers,
//                     correlationId, orderId, shipmentId, externalRef,
//                     actor, tenantId, status?, attemptCount? })
//   recordOutbound (… same shape …)
//   markDelivered      (id, { actor })
//   markAcknowledged   (id, { actor })
//   markProcessed      (id, { actor, orderId?, shipmentId? })
//   markFailed         (id, err)
//   incrementAttempt   (id)
//
// Idempotency:
//   - When `correlationId` is supplied AND the partial unique index
//     `(source_system, correlation_id)` is hit, recordInbound /
//     recordOutbound return `{ id, alreadyRecorded: true }` so the
//     caller can short-circuit.  Mirrors fusionIngest/eventLog.start.
//
// Transaction boundaries (zoree_db_rules.pdf §Data Integrity 3):
//   - The writer accepts an optional `client` override; callers who
//     are inside a transaction (e.g. order ingest service) pass their
//     transactional client so the ledger insert and the business
//     commit happen atomically.  When no client is supplied the
//     writer uses the default Supabase client.
//
// Feature flag:
//   - `MESSAGING_HUB_PERSIST=false` short-circuits every write to a
//     no-op so the rollout can be paused without removing call sites.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const db = require('../supabase');
const {
  DIRECTION,
  STATUS,
  assertDirection,
  assertSystemParty,
  assertMessageType,
  assertStatus,
  isTerminal,
} = require('./types');

const TABLE = 'message_log';

// Feature flag — read once at require-time; restart toggles it.
const PERSIST_ENABLED = process.env.MESSAGING_HUB_PERSIST !== 'false';

// PG unique-violation code; supabase-js may surface it via err.code or
// in err.message (mirrors fusionIngest/eventLog.start).
const PG_UNIQUE_VIOLATION = '23505';

function _client(clientOverride) {
  return clientOverride || db.getClient();
}

function _truncate(s, max = 2000) {
  if (s == null) return null;
  const str = typeof s === 'string' ? s : String(s);
  return str.length > max ? str.slice(0, max) : str;
}

// Build the row from a normalised input.  Defaults follow the lifecycle:
//   inbound  → status='received'
//   outbound → status='sent'  (callers can override with PENDING)
function _buildRow(args, direction) {
  const messageType  = assertMessageType(args.messageType);
  const sourceSystem = assertSystemParty(args.source, 'source');
  const targetSystem = assertSystemParty(args.target, 'target');
  assertDirection(direction);

  const status = args.status
    ? assertStatus(args.status)
    : (direction === DIRECTION.INBOUND ? STATUS.RECEIVED : STATUS.SENT);

  if (!args.payload || typeof args.payload !== 'object') {
    const e = new Error('messagingHub.writer: payload object is required');
    e.status = 400;
    throw e;
  }

  return {
    message_type:   messageType,
    direction,
    source_system:  sourceSystem,
    target_system:  targetSystem,
    correlation_id: args.correlationId || null,
    order_id:       args.orderId       != null ? String(args.orderId)    : null,
    shipment_id:    args.shipmentId    != null ? String(args.shipmentId) : null,
    external_ref:   args.externalRef   || null,
    status,
    attempt_count:  Number.isFinite(args.attemptCount) ? args.attemptCount : 0,
    last_error:     null,
    payload:        args.payload,
    headers:        args.headers || null,
    actor:          args.actor   || null,
    tenant_id:      args.tenantId || 'zoree-default',
  };
}

// Core insert — used by both recordInbound and recordOutbound. Returns
// { id, alreadyRecorded }. On unique-violation against
// (source_system, correlation_id), returns the existing row id with
// alreadyRecorded=true.
async function _insert(row, clientOverride) {
  if (!PERSIST_ENABLED) {
    // Feature-flagged off: pretend it succeeded but do not touch the DB.
    // The caller's flow continues unaffected.
    return { id: null, alreadyRecorded: false, persisted: false };
  }

  const client = _client(clientOverride);
  const { data, error } = await client.from(TABLE).insert(row).select('id').single();

  if (!error) return { id: data.id, alreadyRecorded: false, persisted: true };

  const isConflict = error.code === PG_UNIQUE_VIOLATION
    || /duplicate key/i.test(error.message || '');

  if (!isConflict || !row.correlation_id) {
    const e = new Error(`[messagingHub.writer] insert failed: ${error.message}`);
    e.cause = error;
    throw e;
  }

  // Conflict on (source_system, correlation_id) — find the existing row.
  const { data: existing, error: lookupErr } = await client
    .from(TABLE)
    .select('id, status')
    .eq('source_system', row.source_system)
    .eq('correlation_id', row.correlation_id)
    .limit(1)
    .single();

  if (lookupErr) {
    const e = new Error(`[messagingHub.writer] lookup after conflict failed: ${lookupErr.message}`);
    e.cause = lookupErr;
    throw e;
  }

  return { id: existing.id, alreadyRecorded: true, persisted: true };
}

// ── Public: record an inbound message ────────────────────────────
async function recordInbound(args, opts = {}) {
  const row = _buildRow(args, DIRECTION.INBOUND);
  return _insert(row, opts.client);
}

// ── Public: record an outbound message ───────────────────────────
async function recordOutbound(args, opts = {}) {
  const row = _buildRow(args, DIRECTION.OUTBOUND);
  return _insert(row, opts.client);
}

// ── Public: status transitions ───────────────────────────────────
// All transitions go through _patchStatus so the terminal-state guard
// is in one place.
async function _patchStatus(id, nextStatus, extra = {}, clientOverride) {
  if (!PERSIST_ENABLED || !id) return { persisted: false };
  assertStatus(nextStatus);

  const client = _client(clientOverride);

  // Read current status — refuse transitions out of a terminal state
  // (zoree_db_rules.pdf §Data Integrity 1 — DB-level enforcement isn't
  // possible without a CHECK on a function, so we enforce here).
  const { data: prior, error: readErr } = await client
    .from(TABLE).select('id, status').eq('id', id).limit(1).single();
  if (readErr) {
    console.error('[messagingHub.writer] status read failed:', readErr.message);
    return { persisted: false };
  }
  if (isTerminal(prior.status) && prior.status !== nextStatus) {
    console.warn(`[messagingHub.writer] ignored ${prior.status}→${nextStatus} on id=${id} (terminal)`);
    return { persisted: false, ignored: true };
  }

  const patch = {
    status:       nextStatus,
    processed_at: new Date().toISOString(),
  };
  if (extra.error)       patch.last_error  = _truncate(extra.error);
  if (extra.orderId)     patch.order_id    = String(extra.orderId);
  if (extra.shipmentId)  patch.shipment_id = String(extra.shipmentId);
  if (extra.actor)       patch.actor       = extra.actor;

  const { error: updErr } = await client.from(TABLE).update(patch).eq('id', id);
  if (updErr) {
    console.error('[messagingHub.writer] status update failed:', updErr.message);
    return { persisted: false };
  }
  return { persisted: true };
}

async function markDelivered(id, opts = {}) {
  return _patchStatus(id, STATUS.DELIVERED,    { actor: opts.actor }, opts.client);
}
async function markAcknowledged(id, opts = {}) {
  return _patchStatus(id, STATUS.ACKNOWLEDGED, { actor: opts.actor }, opts.client);
}
async function markProcessed(id, opts = {}) {
  return _patchStatus(id, STATUS.PROCESSED,    {
    actor:      opts.actor,
    orderId:    opts.orderId,
    shipmentId: opts.shipmentId,
  }, opts.client);
}

async function markFailed(id, err, opts = {}) {
  const message = (err && err.message) || String(err || 'unknown');
  return _patchStatus(id, STATUS.FAILED, { error: message, actor: opts.actor }, opts.client);
}

async function incrementAttempt(id, clientOverride) {
  if (!PERSIST_ENABLED || !id) return { persisted: false };
  const client = _client(clientOverride);
  // Read-modify-write: supabase-js doesn't expose RAW SQL increments
  // through .update(). The race window here is acceptable for
  // attempt_count (best-effort counter, not a balance).
  const { data: prior, error: readErr } = await client
    .from(TABLE).select('attempt_count').eq('id', id).limit(1).single();
  if (readErr) {
    console.error('[messagingHub.writer] attempt read failed:', readErr.message);
    return { persisted: false };
  }
  const next = (prior.attempt_count || 0) + 1;
  const { error: updErr } = await client.from(TABLE).update({ attempt_count: next }).eq('id', id);
  if (updErr) {
    console.error('[messagingHub.writer] attempt update failed:', updErr.message);
    return { persisted: false };
  }
  return { persisted: true, attemptCount: next };
}

module.exports = {
  recordInbound,
  recordOutbound,
  markDelivered,
  markAcknowledged,
  markProcessed,
  markFailed,
  incrementAttempt,
  // exposed for tests / verification grep
  _PERSIST_ENABLED: PERSIST_ENABLED,
  _TABLE: TABLE,
};
