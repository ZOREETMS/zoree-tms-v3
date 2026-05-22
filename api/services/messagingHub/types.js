// ═══════════════════════════════════════════════════════════════════
// Messaging Hub — types & validators.
//
// Single source of truth for the enum codes used across the Hub. The
// canonical catalog is the lookup tables seeded in
// api/migrations/038_messaging_hub.sql; this module mirrors those
// codes for compile-time safety and exposes small validators that the
// writer/reader/correlate modules use to fail fast on bad input.
//
// Why duplicate the codes here:
//   - The writer and adapters need to refer to codes (e.g.
//     MESSAGE_TYPE.SHIPMENT_TENDER) without a DB round-trip.
//   - Adding a new code is still a 2-line change: insert into the
//     lookup table (migration) and add it here.
//
// Per CLAUDE_RULES §10 we use clear shared types instead of stringly
// typed arguments inside the service layer.
// ═══════════════════════════════════════════════════════════════════

'use strict';

// ── Direction ────────────────────────────────────────────────────
const DIRECTION = Object.freeze({
  INBOUND:  'inbound',
  OUTBOUND: 'outbound',
});

// ── System parties (FK → system_party_lookup) ────────────────────
const SYSTEM_PARTY = Object.freeze({
  OMS:     'OMS',
  TMS:     'TMS',
  CARRIER: 'CARRIER',
});

// ── Message types (FK → message_type_lookup) ─────────────────────
// Lifecycle-first ordering matches docs/messaging-hub/plan.md §1.
const MESSAGE_TYPE = Object.freeze({
  // 6-hop lifecycle
  ORDER_CREATION:    'ORDER_CREATION',
  SHIPMENT_TENDER:   'SHIPMENT_TENDER',
  TENDER_RESPONSE:   'TENDER_RESPONSE',
  SHIPMENT_DETAILS:  'SHIPMENT_DETAILS',
  SHIP_CONFIRMATION: 'SHIP_CONFIRMATION',
  DELIVERED:         'DELIVERED',

  // Entity-master sync + operational carrier events (migration 042)
  ITEM_SYNC:          'ITEM_SYNC',      // OMS/ERP → TMS item (SKU) master sync
  LOCATION_SYNC:      'LOCATION_SYNC',  // OMS/ERP → TMS location master sync
  CARRIER_EVENT:      'CARRIER_EVENT',  // Carrier → TMS operational milestone

  // Supplementary (UI compose / legacy)
  TENDER_OFFER:       'TENDER_OFFER',
  SHIPMENT_CREATE:    'SHIPMENT_CREATE',
  SHIPMENT_UPDATE:    'SHIPMENT_UPDATE',
  SHIPMENT_STATUS:    'SHIPMENT_STATUS',
  WMS_SYNC:           'WMS_SYNC',
  DOCK_APPT:          'DOCK_APPT',
  EVENT_NOTIFICATION: 'EVENT_NOTIFICATION',
  RATE_REQUEST:       'RATE_REQUEST',
  RATE_RESPONSE:      'RATE_RESPONSE',
  BOL_TRANSMIT:       'BOL_TRANSMIT',
  INVOICE:            'INVOICE',
});

// ── Statuses (FK → message_status_lookup) ────────────────────────
const STATUS = Object.freeze({
  PENDING:      'pending',
  SENT:         'sent',
  DELIVERED:    'delivered',
  ACKNOWLEDGED: 'acknowledged',
  RECEIVED:     'received',
  PROCESSED:    'processed',
  FAILED:       'failed',
  REPLAYED:     'replayed',
});

// Statuses that are "terminal" — no further transition expected. The
// writer guards against transitions out of a terminal state. Keep in
// sync with message_status_lookup.terminal=TRUE rows.
const TERMINAL_STATUSES = Object.freeze(new Set([
  STATUS.DELIVERED,
  STATUS.ACKNOWLEDGED,
  STATUS.PROCESSED,
  STATUS.REPLAYED,
]));

// ── Validators ───────────────────────────────────────────────────
// Each validator throws a 400-style error so callers can surface a
// useful HTTP status. Keep them small and explicit (CLAUDE_RULES §6).

function _err(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

function assertDirection(value) {
  if (value !== DIRECTION.INBOUND && value !== DIRECTION.OUTBOUND) {
    throw _err(`messagingHub: invalid direction "${value}" (expected inbound|outbound)`);
  }
  return value;
}

function assertSystemParty(value, label = 'system_party') {
  if (!value || !Object.prototype.hasOwnProperty.call(SYSTEM_PARTY, String(value).toUpperCase())) {
    throw _err(`messagingHub: invalid ${label} "${value}" (expected OMS|TMS|CARRIER)`);
  }
  return String(value).toUpperCase();
}

function assertMessageType(value) {
  if (!value || !Object.prototype.hasOwnProperty.call(MESSAGE_TYPE, value)) {
    throw _err(`messagingHub: invalid message_type "${value}"`);
  }
  return value;
}

function assertStatus(value) {
  const codes = Object.values(STATUS);
  if (!codes.includes(value)) {
    throw _err(`messagingHub: invalid status "${value}" (expected one of ${codes.join('|')})`);
  }
  return value;
}

function isTerminal(status) {
  return TERMINAL_STATUSES.has(status);
}

module.exports = {
  DIRECTION,
  SYSTEM_PARTY,
  MESSAGE_TYPE,
  STATUS,
  TERMINAL_STATUSES,
  assertDirection,
  assertSystemParty,
  assertMessageType,
  assertStatus,
  isTerminal,
};
