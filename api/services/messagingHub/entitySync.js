// ═══════════════════════════════════════════════════════════════════
// Messaging Hub — entity-sync adapter.
//
// Thin mapping layer that turns an entity-master write (items,
// locations) into a single inbound Messaging Hub message. Keeps the
// call sites (server.js generic /api/db route, routes/locations.js)
// thin per CLAUDE_RULES §6/§10 — they call recordEntitySync(...) and
// never build a hub row inline.
//
// Direction/semantics:
//   Master data conventionally originates in OMS/ERP and lands in TMS,
//   so these are recorded as INBOUND messages with source=OMS,
//   target=TMS. (A TMS-native create is still meaningfully "an item/
//   location entering the TMS picture", so inbound is the right lane.)
//
// Every call is best-effort: a hub-logging failure must NEVER break the
// user-visible write that triggered it (mirrors omsSync/ingest hooks).
// The single-writer guarantee still holds — all persistence goes
// through writer.recordInbound.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const writer = require('./writer');
const { MESSAGE_TYPE, SYSTEM_PARTY } = require('./types');

// Which physical tables map to which hub message type. Only entity-
// master tables the Messaging Hub cares about are listed; anything else
// is ignored (returns a no-op) so the generic /api/db route can call
// this unconditionally.
const TABLE_TO_MESSAGE_TYPE = Object.freeze({
  items:         MESSAGE_TYPE.ITEM_SYNC,
  locations:     MESSAGE_TYPE.LOCATION_SYNC,
  oms_locations: MESSAGE_TYPE.LOCATION_SYNC,
});

function isTracked(table) {
  return Object.prototype.hasOwnProperty.call(TABLE_TO_MESSAGE_TYPE, String(table || ''));
}

// Pull a human-meaningful reference id off the row(s) for the message
// list "Ref" column. Accepts a single row object or an array (bulk
// upsert) and returns the first row's id.
function _refOf(row) {
  const first = Array.isArray(row) ? row[0] : row;
  if (!first || typeof first !== 'object') return null;
  return first.id != null ? String(first.id) : (first.name ? String(first.name) : null);
}

// Record an entity-master write as an inbound hub message.
//
//   recordEntitySync({ table, row, action, user })
//
// • table  — physical table name (e.g. 'items', 'locations')
// • row    — the upserted row, or array of rows for a bulk write
// • action — 'create' | 'update' (folded into the payload envelope)
// • user   — { email?, tenantId? } (optional)
//
// Returns the writer result, or { skipped: true } when the table isn't
// tracked. Never throws — callers may `await` it without a try/catch,
// but wrapping in try/catch at the call site is still recommended so a
// rejected promise can't bubble through an async handler.
async function recordEntitySync({ table, row, action = 'create', user } = {}) {
  const messageType = TABLE_TO_MESSAGE_TYPE[String(table || '')];
  if (!messageType) return { skipped: true };

  const rows = Array.isArray(row) ? row : [row];
  const payload = {
    entity: table,
    action,
    count: rows.length,
    rows,
  };

  return writer.recordInbound({
    messageType,
    source:      SYSTEM_PARTY.OMS,
    target:      SYSTEM_PARTY.TMS,
    payload,
    externalRef: _refOf(row),
    actor:       (user && user.email) || 'tms-entity-sync',
    tenantId:    user && user.tenantId,
  });
}

module.exports = {
  recordEntitySync,
  isTracked,
  TABLE_TO_MESSAGE_TYPE,
};
