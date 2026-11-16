// ═══════════════════════════════════════════════════════════════════
// Carrier Sourcing Agent
//   input : { shipmentId }  or  { scan: true, limit? } (Planned loads with no carrier)
//   plan  : eligible carriers → contract price (TL) + service + lane history → rank
//   action: SEND_LOAD_OFFER (top 3) · ASSIGN_CARRIER (top 1)   — confirm tier
// ═══════════════════════════════════════════════════════════════════

'use strict';

const db = require('../../supabase');
const { quoteLane } = require('../../rating/tlQuoteService');
const { changeShipmentCarrier } = require('../../shipmentMutations');
const { sendAgentMessage } = require('../outbound/outboundMessage');
const { eligibleCarriers, laneHistory, scoreCarriers, buildLoadOfferEmail } = require('./carrierScoring');

const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const SHIP_COLS = 'id,carrier,mode,origin,dest,weight,pieces,status,pickup_date,delivery_date,equipment,commodity,total_cost,miles,rate_id';

function validateInput(i) {
  if (i.shipmentId) return { shipmentId: String(i.shipmentId).trim() };
  if (i.scan) return { scan: true, limit: Math.min(Number(i.limit) || 3, 10) };
  throw bad('Give a shipmentId, or scan: true to pick up Planned loads with no carrier.');
}

async function loadShipments(input) {
  if (input.shipmentId) {
    const rows = await db.dbSelect('shipments', { select: SHIP_COLS, filters: [['id', 'eq', input.shipmentId]], limit: 1 });
    if (!rows.length) throw bad(`Shipment not found: ${input.shipmentId}`, 404);
    return rows;
  }
  return db.dbSelect('shipments', { select: SHIP_COLS, filters: [['status', 'eq', 'Planned'], ['carrier', 'is', null]], order: { col: 'pickup_date', asc: true }, limit: input.limit });
}

async function priceMap(shipment) {
  if (String(shipment.mode || 'TL').toUpperCase() !== 'TL') return new Map();
  const { quotes } = await quoteLane({ origin: shipment.origin, dest: shipment.dest, weight: shipment.weight });
  const m = new Map();
  for (const q of quotes) { const k = q.carrier.toUpperCase(); if (!m.has(k)) m.set(k, q); } // quotes are cost-sorted
  return m;
}

async function rankForShipment(shipment, carriers, past) {
  const eligible = eligibleCarriers(carriers, shipment);
  const ranked = scoreCarriers(eligible, await priceMap(shipment), laneHistory(past, shipment));
  return { shipment, ranked, eligibleCount: eligible.length };
}

function actionsFor({ shipment, ranked }) {
  const top = ranked.slice(0, 3);
  const actions = top.map((c, i) => {
    const mail = buildLoadOfferEmail({ shipment, candidate: c });
    return {
      type: 'SEND_LOAD_OFFER',
      title: `#${i + 1} ${c.carrier} (score ${c.score}) — offer ${shipment.id}${c.quote ? ` at $${c.quote.total.toLocaleString('en-US')}` : ' (spot)'}`,
      entityType: 'shipment', entityId: shipment.id, dedupe: c.carrier,
      payload: { shipmentId: shipment.id, carrier: c.carrier, carrierId: c.carrierId, to: c.email, subject: mail.subject, body: mail.body, score: c.score, reasons: c.reasons },
    };
  });
  const best = top.find((c) => c.quote) || null;
  if (best && String(best.carrier).toUpperCase() !== String(shipment.carrier || '').toUpperCase()) {
    actions.push({
      type: 'ASSIGN_CARRIER',
      title: `Assign ${best.carrier} to ${shipment.id} at $${best.quote.total.toLocaleString('en-US')}${shipment.carrier ? ` (was ${shipment.carrier})` : ''}`,
      entityType: 'shipment', entityId: shipment.id, dedupe: best.carrier,
      payload: {
        shipmentId: shipment.id, carrier: best.carrier, previousCarrier: shipment.carrier || null,
        total_cost: best.quote.total, rate: best.quote.base, fuel_surcharge: best.quote.fsc, miles: best.quote.miles, rate_id: String(best.quote.rateId),
      },
    });
  }
  return actions;
}

async function plan(input) {
  const shipments = await loadShipments(input);
  if (!shipments.length) return { summary: 'No Planned loads without a carrier — nothing to source.', actions: [] };
  const [carriers, past] = await Promise.all([
    db.dbSelect('carriers', { limit: 500 }),
    db.dbSelect('shipments', { select: 'id,carrier,origin,dest', order: { col: 'created_at', asc: false }, limit: 1000 }),
  ]);
  const results = [];
  for (const s of shipments) results.push(await rankForShipment(s, carriers, past)); // eslint-disable-line no-await-in-loop
  const lead = results[0];
  return {
    summary: results.map((r) => `${r.shipment.id}: ${r.ranked[0] ? `${r.ranked[0].carrier} ranks first (score ${r.ranked[0].score}) of ${r.eligibleCount} eligible` : 'no eligible carrier'}`).join(' · '),
    entityType: 'shipment',
    entityId: results.length === 1 ? lead.shipment.id : null,
    findings: { shipments: results.map((r) => ({ shipment: r.shipment, eligibleCount: r.eligibleCount, ranked: r.ranked.slice(0, 6) })) },
    actions: results.flatMap(actionsFor),
  };
}

const executors = {
  SEND_LOAD_OFFER: (p, ctx) => sendAgentMessage({
    audience: 'carrier', messageType: 'TENDER_OFFER', to: p.to, subject: p.subject, body: p.body, shipmentId: p.shipmentId, externalRef: p.carrierId,
  }, ctx),
  ASSIGN_CARRIER: async (p, ctx) => {
    const after = await changeShipmentCarrier({
      shipmentId: p.shipmentId,
      payload: { carrier: p.carrier, total_cost: p.total_cost, rate: p.rate, fuel_surcharge: p.fuel_surcharge, miles: p.miles, rate_id: p.rate_id },
      user: ctx.user,
    });
    return { shipmentId: p.shipmentId, carrier: (after && after.carrier) || p.carrier, total_cost: (after && after.total_cost) || p.total_cost, previousCarrier: p.previousCarrier };
  },
};

module.exports = {
  key: 'carrier_sourcing', validateInput, plan, executors,
  editableFields: { SEND_LOAD_OFFER: ['to', 'subject', 'body'], ASSIGN_CARRIER: ['total_cost'] },
};
