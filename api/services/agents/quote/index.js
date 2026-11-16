// ═══════════════════════════════════════════════════════════════════
// Quote Agent
//   input : { emailText, from?, subject? }  — an RFQ email (Claude reads it)
//        or { origin, dest, weight?, pickupDate?, equipment?, customer?, contactEmail? }
//        + optional { marginPct }
//   plan  : rate each lane (tlQuoteService) → margin → draft reply
//   action: SEND_QUOTE (customer email; confirm tier)
// ═══════════════════════════════════════════════════════════════════

'use strict';

const { extractRfq } = require('./rfqExtractor');
const { quoteLane } = require('../../rating/tlQuoteService');
const { sendAgentMessage } = require('../outbound/outboundMessage');
const { applyMargin, pickOptions, buildQuoteEmail, marginSettings, addDays } = require('./quotePricing');

const bad = (msg) => { const e = new Error(msg); e.status = 400; return e; };

function validateInput(i) {
  const emailText = String(i.emailText || '').trim();
  if (!emailText && !(i.origin && i.dest)) throw bad('Paste the RFQ email, or give origin and dest.');
  return {
    emailText: emailText || null,
    from: i.from || null,
    subject: i.subject || null,
    origin: i.origin || null,
    dest: i.dest || null,
    weight: Number(i.weight) || null,
    pickupDate: i.pickupDate || null,
    equipment: i.equipment || null,
    customer: i.customer || null,
    contactEmail: i.contactEmail || null,
    marginPct: i.marginPct === undefined || i.marginPct === '' ? null : Number(i.marginPct),
  };
}

const senderEmail = (from) => ((String(from || '').match(/<([^>]+)>/) || [])[1] || (String(from || '').includes('@') ? String(from).trim() : null));

async function readRequest(input) {
  if (!input.emailText) {
    return {
      rfq: {
        is_rfq: true, customer: input.customer, contact_name: null, contact_email: input.contactEmail,
        lanes: [{ origin: input.origin, dest: input.dest, weight_lbs: input.weight, pickup_date: input.pickupDate, equipment: input.equipment, mode: 'TL' }],
        questions: [],
      },
    };
  }
  return extractRfq({ from: input.from, subject: input.subject, text: input.emailText });
}

async function priceLane(lane, margin) {
  const weight = Number(lane.weight_lbs) || 0;
  const { quotes, laneMiles, diesel } = await quoteLane({ origin: lane.origin, dest: lane.dest, weight });
  const options = pickOptions(quotes, 3).map((q) => ({ ...q, ...applyMargin(q.total, margin) }));
  return { lane, weight, laneMiles, diesel, options, recommended: options[0] || null, ratedCarriers: new Set(quotes.map((q) => q.carrier)).size };
}

async function plan(input, ctx = {}) {
  const { rfq, model, usage } = await readRequest(input);
  if (!rfq.is_rfq || !rfq.lanes.length) {
    return { summary: 'This email is not a rate request — nothing to quote.', model, usage, findings: { rfq }, actions: [] };
  }
  const margin = marginSettings(process.env, input.marginPct);
  const priced = [];
  for (const lane of rfq.lanes) priced.push(await priceLane(lane, margin)); // eslint-disable-line no-await-in-loop
  const diesel = (priced.find((p) => p.diesel) || {}).diesel || null;
  const validUntil = addDays(null, margin.validDays);

  const lanes = priced.map((p) => ({
    origin: p.lane.origin, dest: p.lane.dest, weight: p.weight || null, equipment: p.lane.equipment || null,
    pickupDate: p.lane.pickup_date || null,
    sell: p.recommended ? p.recommended.sell : null,
    cost: p.recommended ? p.recommended.cost : null,
    marginUsd: p.recommended ? p.recommended.marginUsd : null,
    marginPct: p.recommended ? p.recommended.marginPct : null,
    carrier: p.recommended ? p.recommended.carrier : null,
    transitDays: p.recommended ? p.recommended.transitDays : null,
    fscSource: p.recommended ? p.recommended.fscSource : null,
  }));
  const email = buildQuoteEmail({ contactName: rfq.contact_name, lanes, validUntil, diesel, subject: input.subject });
  const to = rfq.contact_email || senderEmail(input.from);
  const pricedCount = lanes.filter((l) => l.sell).length;
  const totalSell = lanes.reduce((s, l) => s + (l.sell || 0), 0);
  const totalMargin = lanes.reduce((s, l) => s + (l.marginUsd || 0), 0);

  return {
    summary: `${pricedCount}/${lanes.length} lane(s) priced for ${rfq.customer || to || 'the sender'} · quote $${totalSell.toLocaleString('en-US')} · margin $${totalMargin.toLocaleString('en-US')}`,
    entityType: 'rfq',
    entityId: input.subject || null,
    model, usage,
    findings: {
      rfq: { customer: rfq.customer, contact_name: rfq.contact_name, contact_email: to, questions: rfq.questions || [] },
      margin, diesel, validUntil,
      lanes: priced.map((p) => ({
        origin: p.lane.origin, dest: p.lane.dest, weight: p.weight, laneMiles: p.laneMiles, ratedCarriers: p.ratedCarriers,
        options: p.options.map((o) => ({ carrier: o.carrier, rpm: o.rpm, miles: o.miles, base: o.base, fscPct: o.fscPct, fscSource: o.fscSource, fsc: o.fsc, cost: o.cost, sell: o.sell, marginUsd: o.marginUsd, transitDays: o.transitDays, rateId: o.rateId })),
      })),
    },
    actions: pricedCount ? [{
      type: 'SEND_QUOTE',
      title: `Send ${totalSell ? `$${totalSell.toLocaleString('en-US')} ` : ''}quote to ${to || rfq.customer || 'customer'}`,
      entityType: 'rfq',
      entityId: to || rfq.customer || 'rfq',
      // One quote per request: a customer asking again later is a new quote, so key on the run.
      dedupe: (ctx.run && ctx.run.id) || lanes.map((l) => `${l.origin}>${l.dest}:${l.sell}`).join('|'),
      payload: { to, subject: email.subject, body: email.body, customer: rfq.customer, lanes, validUntil },
    }] : [],
  };
}

const executors = {
  SEND_QUOTE: (p, ctx) => sendAgentMessage({ audience: 'customer', to: p.to, subject: p.subject, body: p.body }, ctx),
};

module.exports = { key: 'quote', validateInput, plan, executors, editableFields: { SEND_QUOTE: ['to', 'subject', 'body'] } };
