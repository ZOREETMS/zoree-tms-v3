// ═══════════════════════════════════════════════════════════════════
// Track & Trace Agent
//   input : { scan: true, limit? }                     find loads at risk → check calls
//        or { shipmentId, carrierReply }               read a carrier reply → event (+ delay notice)
//   action: SEND_CHECK_CALL · APPLY_SHIPMENT_EVENT · NOTIFY_CUSTOMER — confirm tier
//           (raise SEND_CHECK_CALL to auto with AGENT_POLICY_SEND_CHECK_CALL=auto)
// ═══════════════════════════════════════════════════════════════════

'use strict';

const db = require('../../supabase');
const { applyShipmentEvent } = require('../../shipmentEvents');
const { sendAgentMessage } = require('../outbound/outboundMessage');
const { assessShipment, inWindow, buildCheckCallEmail, buildDelayNotice } = require('./etaRisk');
const { classifyCarrierReply } = require('./carrierReplyClassifier');

const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const COLS = 'id,carrier,mode,origin,dest,status,pickup_date,delivery_date,shipped_at,updated_at,created_at,bol_number,pro_number,order_ids';
const LEVEL_RANK = { high: 0, medium: 1, ok: 2 };

function validateInput(i) {
  if (i.shipmentId && String(i.carrierReply || '').trim()) {
    return { mode: 'reply', shipmentId: String(i.shipmentId).trim(), carrierReply: String(i.carrierReply) };
  }
  if (i.scan || !i.shipmentId) return { mode: 'scan', limit: Math.min(Number(i.limit) || 5, 20) };
  throw bad('Give scan: true, or a shipmentId with the carrier reply text.');
}

async function carrierEmails() {
  const rows = await db.dbSelect('carriers', { select: 'name,contact_email,email', limit: 500 });
  return new Map(rows.map((c) => [String(c.name).toUpperCase(), c.contact_email || c.email || null]));
}

async function planScan(input) {
  const today = new Date().toISOString().slice(0, 10);
  const lookbackDays = Number(process.env.AGENT_TRACE_LOOKBACK_DAYS) || 14;
  const moving = await db.dbSelect('shipments', { select: COLS, filters: [['status', 'in', ['Tender Accepted', 'In Transit']]], limit: 1000 });
  const assessed = moving
    .filter((s) => inWindow(s, { today, lookbackDays }))
    .map((s) => ({ s, risk: assessShipment(s, { today }) }));
  const atRisk = assessed.filter((x) => x.risk.level !== 'ok')
    .sort((a, b) => LEVEL_RANK[a.risk.level] - LEVEL_RANK[b.risk.level])
    .slice(0, input.limit);
  const emails = await carrierEmails();
  return {
    summary: `${assessed.length} moving load(s) in the last ${lookbackDays} days · ${assessed.filter((x) => x.risk.level === 'high').length} high risk · ${assessed.filter((x) => x.risk.level === 'medium').length} medium · ${atRisk.length} check call(s) drafted`,
    findings: { scanned: assessed.length, loads: assessed.sort((a, b) => LEVEL_RANK[a.risk.level] - LEVEL_RANK[b.risk.level]).slice(0, 25).map(({ s, risk }) => ({ id: s.id, carrier: s.carrier, lane: `${s.origin} → ${s.dest}`, status: s.status, pickup: s.pickup_date, delivery: s.delivery_date, risk })) },
    actions: atRisk.map(({ s, risk }) => {
      const mail = buildCheckCallEmail(s, risk);
      return {
        type: 'SEND_CHECK_CALL',
        title: `${risk.level === 'high' ? '🔴' : '🟠'} Check call ${s.carrier || 'carrier'} on ${s.id} — ${risk.reason}`,
        entityType: 'shipment', entityId: s.id, dedupe: `${risk.code}:${today}`,
        payload: { shipmentId: s.id, carrier: s.carrier, to: emails.get(String(s.carrier || '').toUpperCase()) || null, subject: mail.subject, body: mail.body, risk },
      };
    }),
  };
}

async function customerFor(shipment) {
  const ids = Array.isArray(shipment.order_ids) ? shipment.order_ids : [];
  if (!ids.length) return null;
  const rows = await db.dbSelect('orders', { select: 'customer', filters: [['id', 'in', ids.slice(0, 5)]], limit: 5 });
  return (rows.find((r) => r.customer) || {}).customer || null;
}

function eventNote(update) {
  return [
    `[Zoree AI · Track & Trace] ${update.summary}`,
    update.location ? `Location: ${update.location}` : null,
    update.eta_date ? `ETA: ${update.eta_date}` : null,
    update.delivered_to ? `Signed by: ${update.delivered_to}` : null,
  ].filter(Boolean).join(' · ');
}

async function planReply(input) {
  const rows = await db.dbSelect('shipments', { select: COLS, filters: [['id', 'eq', input.shipmentId]], limit: 1 });
  const shipment = rows[0];
  if (!shipment) throw bad(`Shipment not found: ${input.shipmentId}`, 404);
  const { update, model, usage } = await classifyCarrierReply({ shipment, replyText: input.carrierReply });
  const today = new Date().toISOString().slice(0, 10);
  const actions = [{
    type: 'APPLY_SHIPMENT_EVENT',
    title: `Record "${update.event_type}" on ${shipment.id}${update.location ? ` at ${update.location}` : ''}${update.eta_date ? ` · ETA ${update.eta_date}` : ''}`,
    entityType: 'shipment', entityId: shipment.id, dedupe: `${update.event_type}:${update.eta_date || ''}:${today}`,
    payload: { shipmentId: shipment.id, type: update.event_type, note: eventNote(update), date: update.event_type === 'Delivered' ? today : null, update },
  }];
  const late = update.event_type === 'Delay' || (update.eta_date && shipment.delivery_date && update.eta_date > String(shipment.delivery_date).slice(0, 10));
  if (late) {
    const customer = await customerFor(shipment);
    const mail = buildDelayNotice({ shipment, customer, update });
    actions.push({
      type: 'NOTIFY_CUSTOMER',
      title: `Tell ${customer || 'the customer'} ${shipment.id} is late${update.eta_date ? ` — new ETA ${update.eta_date}` : ''}`,
      entityType: 'shipment', entityId: shipment.id, dedupe: `delay:${update.eta_date || today}`,
      payload: { shipmentId: shipment.id, customer, to: null, subject: mail.subject, body: mail.body },
    });
  }
  return {
    summary: `${shipment.carrier || 'Carrier'} on ${shipment.id}: ${update.summary} (${Math.round((update.confidence || 0) * 100)}% confident)`,
    entityType: 'shipment', entityId: shipment.id, model, usage,
    findings: { shipment: { id: shipment.id, lane: `${shipment.origin} → ${shipment.dest}`, status: shipment.status, delivery: shipment.delivery_date }, update, late },
    actions,
  };
}

const plan = (input) => (input.mode === 'reply' ? planReply(input) : planScan(input));

const executors = {
  SEND_CHECK_CALL: (p, ctx) => sendAgentMessage({ audience: 'carrier', messageType: 'EVENT_NOTIFICATION', to: p.to, subject: p.subject, body: p.body, shipmentId: p.shipmentId }, ctx),
  APPLY_SHIPMENT_EVENT: (p, ctx) => applyShipmentEvent({ shipmentId: p.shipmentId, type: p.type, note: p.note, date: p.date || undefined, user: ctx.user }),
  NOTIFY_CUSTOMER: (p, ctx) => sendAgentMessage({ audience: 'customer', to: p.to, subject: p.subject, body: p.body, shipmentId: p.shipmentId }, ctx),
};

module.exports = {
  key: 'track_trace', validateInput, plan, executors,
  editableFields: { SEND_CHECK_CALL: ['to', 'subject', 'body'], APPLY_SHIPMENT_EVENT: ['note'], NOTIFY_CUSTOMER: ['to', 'subject', 'body'] },
};
