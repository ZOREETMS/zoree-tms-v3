// ═══════════════════════════════════════════════════════════════════
// Tendering — inbound (Carrier → TMS).
//
// Boundary the Messaging Hub plan §6 identified for hook 3
// (tender_response).  Carrier integration partners POST here (or a
// future EDI 990 gateway hands rows over) when accepting or declining
// a tender we previously emitted via tenderOut.
//
// The correlation_id supplied on the response is the same one we
// generated in tenderOut.tenderShipment — that's how we link the
// pair without an FK.  When supplied, correlate.resolveByCorrelationId
// fills in order_id / shipment_id from the original outbound row.
//
// 2026-08-11: this used to record the message_log row and STOP — a
// carrier ACCEPT was a domain no-op, so the only ways to reach
// 'Tender Accepted' were a human typing `accept` in Teams or clicking
// in the web UI. Now an ACCEPT/DECLINE response also runs the real
// status cascade through shipService.updateShipment (the single
// writer): shipments.status, linked orders (via the
// SHIPMENT_STATUS_TO_ORDER_STATUS map in shipmentEvents.js),
// change_history, OMS mirror, Teams channel card, and the WS bridge
// (bus → wsBroadcast in server.js). The message capture NEVER fails
// because the cascade failed — audit first, effects best-effort.
//
// API:
//   recordTenderResponse({ correlationId, response, payload,
//                          externalRef, shipmentId? }, source)
//     → { messageId, persisted, linkedShipmentId, linkedOrderId,
//         applied, appliedStatus, previousStatus, alreadyApplied,
//         stateWarning }
// ═══════════════════════════════════════════════════════════════════

'use strict';

const writer    = require('../messagingHub/writer');
const correlate = require('../messagingHub/correlate');
const { MESSAGE_TYPE, SYSTEM_PARTY } = require('../messagingHub/types');
const db        = require('../supabase');
const { bus, EVENTS } = require('../eventBus');

// Lazy requires for the cascade so a load failure in one of these
// modules can never take message capture down with it.
function shipService()  { try { return require('../shipments'); }   catch { return null; } }
function teamsNotify()  { try { return require('../teamsNotify'); } catch { return null; } }
function omsSync()      { try { return require('../omsSync'); }     catch { return null; } }

// Normalize the carrier's answer. Partners send all sorts of casings
// and synonyms; anything unrecognized records as-is but applies nothing.
function normalizeResponse(raw) {
  const v = String(raw || '').trim().toUpperCase();
  if (['ACCEPT', 'ACCEPTED', 'YES', 'CONFIRM', 'CONFIRMED'].includes(v)) return 'ACCEPT';
  if (['DECLINE', 'DECLINED', 'REJECT', 'REJECTED', 'NO'].includes(v))   return 'DECLINE';
  return null;
}

const RESPONSE_TO_SHIPMENT_STATUS = {
  ACCEPT:  'Tender Accepted',
  DECLINE: 'Tender Rejected',
};

// Apply the carrier's decision to the shipment. Idempotent: replays of
// the same response (carrier retries, duplicate webhooks) are absorbed
// without a second cascade or duplicate change_history rows.
async function applyResponseToShipment({ shipmentId, decision, correlationId, tenantId }) {
  const targetStatus = RESPONSE_TO_SHIPMENT_STATUS[decision];
  const out = { applied: false, appliedStatus: null, previousStatus: null, alreadyApplied: false, stateWarning: null };
  if (!targetStatus) { out.stateWarning = 'unrecognized response — recorded only'; return out; }

  const rows = await db.dbSelect('shipments', {
    filters: [['id', 'eq', String(shipmentId)]], limit: 1,
    select: 'id,status,carrier,mode,service_level,pickup_date,delivery_date',
  });
  const ship = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!ship) { out.stateWarning = `shipment ${shipmentId} not found — recorded only`; return out; }

  out.previousStatus = ship.status || null;

  if (ship.status === targetStatus) {
    out.alreadyApplied = true;
    return out;
  }
  // Only a pending tender can be answered. Anything else (Planned,
  // In Transit, Delivered, the OTHER tender outcome…) means the
  // response is late, duplicated, or plain wrong — keep the audit row,
  // do not corrupt the shipment.
  if (ship.status !== 'Tendered') {
    out.stateWarning = `shipment is '${ship.status}', not 'Tendered' — response recorded, status NOT changed`;
    return out;
  }

  const svc = shipService();
  if (!svc || typeof svc.updateShipment !== 'function') {
    out.stateWarning = 'shipment service unavailable — recorded only';
    return out;
  }

  // Single-writer path: updateShipment writes the row, the shipment
  // change_history status entry, and cascades linked orders through
  // shipmentEvents.syncLinkedOrdersForShipmentStatus.
  await svc.updateShipment(String(shipmentId), { status: targetStatus }, null, {
    user: { email: 'carrier-ingest', role: 'system' },
    via:  'carrier-tender-response',
  });
  out.applied = true;
  out.appliedStatus = targetStatus;

  // ── best-effort side effects (mirror of the Teams-bot accept path) ──
  // Live-update web/mobile clients (server.js bridges bus → wsBroadcast).
  try {
    bus.emit(EVENTS.SHIPMENT_UPDATED, {
      id: String(shipmentId), status: targetStatus, via: 'carrier-tender-response', correlationId,
    });
  } catch (e) { console.warn('[tenderIn] bus emit failed:', e.message); }

  // Teams channel card.
  try {
    const tn = teamsNotify();
    if (tn) {
      if (decision === 'ACCEPT' && typeof tn.notifyTenderAccepted === 'function') {
        tn.notifyTenderAccepted({
          shipmentId: String(shipmentId),
          carrier: ship.carrier || '',
          mode: ship.mode || '',
          pickupDate: ship.pickup_date || '',
          deliveryDate: ship.delivery_date || '',
        });
      } else if (decision === 'DECLINE' && typeof tn.notifyTenderRejected === 'function') {
        tn.notifyTenderRejected({ shipmentId: String(shipmentId), carrier: ship.carrier || '' });
      }
    }
  } catch (e) { console.warn('[tenderIn] teams notify failed:', e.message); }

  // OMS mirror on accept (same dataset /api/oms/push sends).
  if (decision === 'ACCEPT') {
    try {
      const oms = omsSync();
      if (oms && typeof oms.syncTenderAcceptToOms === 'function') {
        await oms.syncTenderAcceptToOms({
          shipmentId: String(shipmentId),
          carrier: ship.carrier || '',
          mode: ship.mode || '',
          serviceLevel: ship.service_level || '',
          pickupDate: ship.pickup_date || '',
          deliveryDate: ship.delivery_date || '',
        }, { email: 'carrier-ingest', tenantId });
      }
    } catch (e) { console.warn('[tenderIn] OMS mirror failed:', e.message); }
  }

  return out;
}

async function recordTenderResponse(args, source) {
  const correlationId = args && args.correlationId ? String(args.correlationId).trim() : '';
  if (!correlationId) {
    const e = new Error('recordTenderResponse: correlationId is required');
    e.status = 400; throw e;
  }

  // Inherit linkage from the original outbound tender if we can find it.
  const linkage = await correlate.resolveByCorrelationId(correlationId);
  let linkedShipmentId = (linkage && linkage.shipmentId) || null;
  const linkedOrderId  = (linkage && linkage.orderId)    || null;

  // Fallback: partners that echo our shipment id directly (instead of —
  // or in addition to — the correlation id) still get linked.
  if (!linkedShipmentId && args.shipmentId) {
    linkedShipmentId = await correlate.resolveShipmentByExternalRef(String(args.shipmentId));
  }

  const decision = normalizeResponse(args.response);

  const payload = args.payload && typeof args.payload === 'object'
    ? args.payload
    : { correlationId, response: args.response || 'UNKNOWN' };

  const headers = {
    receivedAt: new Date().toISOString(),
    source:     (source && source.email) || 'carrier-ingest',
  };

  // 1. AUDIT FIRST — the ledger row is written before any cascade so a
  //    cascade failure can never lose the carrier's answer.
  const result = await writer.recordInbound({
    messageType:   MESSAGE_TYPE.TENDER_RESPONSE,
    source:        SYSTEM_PARTY.CARRIER,
    target:        SYSTEM_PARTY.TMS,
    payload:       { ...payload, response: args.response || null, normalized: decision },
    headers,
    correlationId,
    orderId:       linkedOrderId,
    shipmentId:    linkedShipmentId,
    externalRef:   args.externalRef || null,
    actor:         (source && source.email) || 'carrier-ingest',
    tenantId:      source && source.tenantId,
  });

  // 2. DOMAIN CASCADE — best-effort, never breaks the 202.
  let applyResult = { applied: false, appliedStatus: null, previousStatus: null, alreadyApplied: false, stateWarning: null };
  if (linkedShipmentId && decision) {
    try {
      applyResult = await applyResponseToShipment({
        shipmentId: linkedShipmentId,
        decision,
        correlationId,
        tenantId: source && source.tenantId,
      });
    } catch (cascadeErr) {
      console.error('[tenderIn] cascade failed:', cascadeErr.message);
      applyResult.stateWarning = `cascade failed: ${cascadeErr.message}`;
    }
  } else if (!linkedShipmentId) {
    applyResult.stateWarning = 'no shipment linkage resolved — response recorded for triage';
  } else if (!decision) {
    applyResult.stateWarning = `unrecognized response '${args.response}' — recorded only`;
  }

  return {
    messageId:       result.id,
    persisted:       result.persisted !== false,
    alreadyRecorded: !!result.alreadyRecorded,
    linkedShipmentId,
    linkedOrderId,
    ...applyResult,
  };
}

module.exports = { recordTenderResponse };
