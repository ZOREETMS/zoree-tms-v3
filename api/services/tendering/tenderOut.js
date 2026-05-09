// ═══════════════════════════════════════════════════════════════════
// Tendering — outbound (TMS → Carrier).
//
// This is the formal boundary the Messaging Hub plan §6 identified
// for hook 2 (shipment_tender).  Today the actual carrier transport
// is not yet implemented — tendering happens in the UI and the
// downstream effect we mirror is captured by omsSync.syncTenderAcceptToOms.
// This module exists so that the *moment* a real carrier transport
// (EDI 204, REST, etc.) is wired in, the call site does not change:
// it already routes through the messaging-hub writer for audit.
//
// API:
//   tenderShipment({ shipmentId, carrierId, payload, correlationId? }, user)
//     → { messageId, correlationId, persisted }
//
// Per CLAUDE_RULES §10 the writer is the only path to message_log.
// This module is a thin adapter — it prepares payload / headers and
// hands off to writer.recordOutbound.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const crypto = require('crypto');
const writer = require('../messagingHub/writer');
const { MESSAGE_TYPE, SYSTEM_PARTY } = require('../messagingHub/types');

function _newCorrelationId() {
  return `tender-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

async function tenderShipment(args, user) {
  const shipmentId = String(args && args.shipmentId || '').trim();
  if (!shipmentId) {
    const e = new Error('tenderShipment: shipmentId is required');
    e.status = 400; throw e;
  }
  const carrierId = args.carrierId ? String(args.carrierId) : null;
  const correlationId = args.correlationId || _newCorrelationId();

  // Headers: nothing transport-specific yet — keep the slot so adapters
  // that take over (EDI 204 gateway, carrier REST clients) have a place
  // to record auth-stripped wire metadata.
  const headers = {
    issuedAt: new Date().toISOString(),
    issuer:   (user && user.email) || 'tms-ui',
    carrier:  carrierId,
  };

  const payload = args.payload && typeof args.payload === 'object'
    ? args.payload
    : { shipmentId, carrierId, note: 'tender payload not supplied — placeholder' };

  const result = await writer.recordOutbound({
    messageType:   MESSAGE_TYPE.SHIPMENT_TENDER,
    source:        SYSTEM_PARTY.TMS,
    target:        SYSTEM_PARTY.CARRIER,
    payload,
    headers,
    correlationId,
    shipmentId,
    externalRef:   carrierId,
    actor:         (user && user.email) || 'tms-system',
    tenantId:      user && user.tenantId,
  });

  return {
    messageId:     result.id,
    correlationId,
    persisted:     result.persisted !== false,
    alreadyRecorded: !!result.alreadyRecorded,
  };
}

module.exports = { tenderShipment };
