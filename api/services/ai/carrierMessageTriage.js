// ═══════════════════════════════════════════════════════════════════
// Carrier message triage — Jev (System 1) with Claude (System 2) escalation.
//
// Jev reads an inbound carrier message and answers five typed questions
// in one parallel call. When the intent confidence clears
// JEV_AUTO_CONFIDENCE (default 0.9) the message is routed to a planned
// action; otherwise it escalates to ZoreeAI (Claude).
//
// DRY RUN: returns the planned action only and writes nothing. To go live,
// replace planAction stubs with calls into the existing single-writer
// services (tenderIn.recordTenderResponse, rateMatcher, order status) so
// audit and patch guards apply.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const jev = require('./jevClient');

const INPUT_COST_PER_TOKEN = 0.042 / 1_000_000; // TypeSafe list price, output free

function autoConfidence() {
  const n = Number(process.env.JEV_AUTO_CONFIDENCE);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.9;
}

const QUESTIONS = {
  intent: {
    type: 'choice',
    instructions: 'What is the carrier primarily communicating about this load',
    criteria: {
      tender_accept: 'Carrier accepts or confirms it will haul the load',
      tender_reject: 'Carrier declines, cancels, or gives back the load',
      delay_notice: 'Carrier reports the load is running late, broke down, or will miss pickup or delivery time',
      delivered_pod: 'Carrier reports the load was delivered or sends proof of delivery',
      accessorial_claim: 'Carrier is claiming detention, layover, lumper, or other extra charges',
      rate_question: 'Carrier is asking about or negotiating the rate',
      other: 'None of the above',
    },
  },
  delay_severity: {
    type: 'score',
    instructions: 'How severe is any delay to this shipment',
    criteria: [
      'No delay',
      'Minor delay, under 2 hours, appointment still met',
      'Significant delay, 2 to 8 hours, appointment at risk',
      'Critical, appointment will be missed or load cannot be completed',
    ],
  },
  needs_retender: {
    type: 'noul',
    instructions: 'The current carrier will not complete this load and it must be tendered to a different carrier',
  },
  customer_must_be_notified: {
    type: 'noul',
    instructions: 'The customer delivery appointment will be missed or changed',
  },
  extra_charges_claimed: {
    type: 'noul',
    instructions: 'The carrier is asking to be paid more than the agreed linehaul rate',
  },
};

function planAction(a) {
  const intent = a.intent.choice;
  if (a.needs_retender.noul >= 0.7 || intent === 'tender_reject') {
    return { action: 'RETENDER_NEXT_CHEAPEST', service: 'rateMatcher -> tender next carrier' };
  }
  switch (intent) {
    case 'tender_accept':
      return { action: 'RECORD_TENDER_ACCEPT', service: 'tenderIn.recordTenderResponse(accepted)' };
    case 'delay_notice':
      return a.customer_must_be_notified.noul >= 0.7
        ? { action: 'OPEN_EXCEPTION_AND_NOTIFY_CUSTOMER', service: 'exception + customer email draft' }
        : { action: 'LOG_DELAY', service: 'shipment event log' };
    case 'delivered_pod':
      return { action: 'MARK_DELIVERED', service: 'order status -> DELIVERED' };
    case 'accessorial_claim':
      return { action: 'HOLD_FOR_INVOICE_AUDIT', service: 'invoiceAudit variance check' };
    default:
      return { action: 'ROUTE_TO_DISPATCHER', service: 'human queue' };
  }
}

async function triageCarrierMessage({ shipmentRef, carrier, message, lane, deliveryDate, status }) {
  const ctx = [lane && `Lane: ${lane}`, deliveryDate && `Delivery appointment: ${deliveryDate}`, status && `TMS status: ${status}`].filter(Boolean).join(' | ');
  const state = `Shipment ${shipmentRef} | Carrier: ${carrier}${ctx ? ' | ' + ctx : ''}\nCarrier message:\n${message}`;
  const res = await jev.systemOne(state, QUESTIONS);
  const a = res.answers;
  const confidence = a.intent.confidence;
  const autonomous = confidence >= autoConfidence();
  const inputTokens = res.usage?.input_tokens ?? 0;

  return {
    shipmentRef,
    carrier,
    message,
    lane,
    status,
    model: res.model,
    intent: a.intent.choice,
    intentProbabilities: a.intent.probabilities,
    confidence,
    delaySeverity: a.delay_severity.score,
    delaySeverityConfidence: a.delay_severity.confidence,
    needsRetender: a.needs_retender.noul,
    notifyCustomer: a.customer_must_be_notified.noul,
    extraCharges: a.extra_charges_claimed.noul,
    route: autonomous ? 'SYSTEM_1_AUTO' : 'ESCALATE_TO_CLAUDE',
    plannedAction: autonomous
      ? planAction(a)
      : { action: 'ESCALATE', service: 'ZoreeAI (Claude) reasons over full shipment context' },
    latencyMs: res.latencyMs,
    inputTokens,
    costUsd: inputTokens * INPUT_COST_PER_TOKEN,
    dryRun: true,
  };
}

module.exports = { triageCarrierMessage, QUESTIONS, planAction };
