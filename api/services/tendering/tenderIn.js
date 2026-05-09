// ═══════════════════════════════════════════════════════════════════
// Tendering — inbound (Carrier → TMS).
//
// Boundary the Messaging Hub plan §6 identified for hook 3
// (tender_response).  Carrier integration partners will POST here
// (or a future EDI 990 gateway will hand rows over) when accepting
// or declining a tender we previously emitted via tenderOut.
//
// The correlation_id supplied on the response is the same one we
// generated in tenderOut.tenderShipment — that's how we link the
// pair without an FK.  When supplied, correlate.resolveByCorrelationId
// fills in order_id / shipment_id from the original outbound row.
//
// API:
//   recordTenderResponse({ correlationId, response, payload, externalRef }, source)
//     → { messageId, persisted, linkedShipmentId, linkedOrderId }
// ═══════════════════════════════════════════════════════════════════

'use strict';

const writer    = require('../messagingHub/writer');
const correlate = require('../messagingHub/correlate');
const { MESSAGE_TYPE, SYSTEM_PARTY } = require('../messagingHub/types');

async function recordTenderResponse(args, source) {
  const correlationId = args && args.correlationId ? String(args.correlationId).trim() : '';
  if (!correlationId) {
    const e = new Error('recordTenderResponse: correlationId is required');
    e.status = 400; throw e;
  }

  // Inherit linkage from the original outbound tender if we can find it.
  const linkage = await correlate.resolveByCorrelationId(correlationId);
  const linkedShipmentId = (linkage && linkage.shipmentId) || null;
  const linkedOrderId    = (linkage && linkage.orderId)    || null;

  const payload = args.payload && typeof args.payload === 'object'
    ? args.payload
    : { correlationId, response: args.response || 'UNKNOWN' };

  const headers = {
    receivedAt: new Date().toISOString(),
    source:     (source && source.email) || 'carrier-ingest',
  };

  const result = await writer.recordInbound({
    messageType:   MESSAGE_TYPE.TENDER_RESPONSE,
    source:        SYSTEM_PARTY.CARRIER,
    target:        SYSTEM_PARTY.TMS,
    payload,
    headers,
    correlationId,
    orderId:       linkedOrderId,
    shipmentId:    linkedShipmentId,
    externalRef:   args.externalRef || null,
    actor:         (source && source.email) || 'carrier-ingest',
    tenantId:      source && source.tenantId,
  });

  return {
    messageId:     result.id,
    persisted:     result.persisted !== false,
    alreadyRecorded: !!result.alreadyRecorded,
    linkedShipmentId,
    linkedOrderId,
  };
}

module.exports = { recordTenderResponse };
