// /api/jev — carrier message triage demo (Jev System 1 + Claude escalation).
//   POST /api/jev/triage        { shipmentRef, carrier, message }
//   POST /api/jev/triage/batch  { messages: [{ shipmentRef, carrier, message }] }
// Dry run only: returns planned actions, writes nothing.

'use strict';

const express = require('express');
const { triageCarrierMessage } = require('../services/ai/carrierMessageTriage');
const jev = require('../services/ai/jevClient');
const intentGate = require('../services/ai/intentGate');
const { logDecision } = require('../services/ai/jevDecisionLog');

const router = express.Router();
const MAX_BATCH = 25;

router.post('/triage', async (req, res) => {
  const { shipmentRef = 'SHP-NEW', carrier = 'Unknown', message } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message is required' });
  try {
    res.json(await triageCarrierMessage({ shipmentRef, carrier, message }));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/triage/batch', async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(0, MAX_BATCH) : [];
  if (!messages.length) return res.status(400).json({ error: 'messages[] is required' });
  const started = Date.now();
  try {
    const results = await Promise.all(messages.map(triageCarrierMessage));
    res.json({ results, wallClockMs: Date.now() - started });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ZoreeAI web chat gate. Claude proposes an action; before it runs, Jev
// checks whether the user's message was actually a request to change data.
// Jev can only VETO (downgrade to no-op), never initiate. Fails open.
//   POST /api/jev/chat-gate  { text, action }
router.post('/chat-gate', async (req, res) => {
  const text = String(req.body?.text || '');
  const action = String(req.body?.action || '');
  if (!text) return res.status(400).json({ error: 'text is required' });
  const started = Date.now();
  try {
    const r = await jev.systemOne(intentGate.buildState(text), intentGate.BOT_QUESTIONS);
    const decision = intentGate.decide({
      isMutating: true, answers: r.answers, vetoThreshold: intentGate.getVetoThreshold(),
    });
    const out = {
      veto: decision.veto,
      reason: decision.reason,
      action,
      intent: r.answers?.intent?.choice,
      intentConfidence: r.answers?.intent?.confidence,
      pQuestion: r.answers?.is_question?.noul,
      latencyMs: r.latencyMs ?? Date.now() - started,
      model: r.model,
    };
    logDecision({ channel: 'web-chat', mode: 'enforce', text, regexCmd: action, isMutating: true,
      intent: out.intent, veto: out.veto, applied: out.veto, reason: out.reason, latencyMs: out.latencyMs, model: out.model });
    res.json(out);
  } catch (err) {
    res.json({ veto: false, failedOpen: true, reason: `jev unavailable (${err.message}); action allowed`, action, latencyMs: Date.now() - started });
  }
});

// Real shipments from the TMS for the inbox demo. Carrier messages are
// templated (Zoree has no free-text carrier inbox yet), but shipment id,
// carrier, lane and dates are live rows from the shipments table.
//   GET /api/jev/samples
const SAMPLE_TEMPLATES = [
  { status: ['Tendered'], text: (s) => `Confirmed, we'll take ${s.id}. Driver will pick up in ${s.o} on ${s.pu} at 0800.` },
  { status: ['Tendered'], text: (s) => `Sorry, can't cover ${s.id} anymore. Truck went down, need to give this one back.` },
  { status: ['Tender Accepted', 'In Transit'], text: (s) => `Driver on ${s.id} stuck in traffic outside ${s.o}, about 40 min behind, still good for the delivery appointment in ${s.d}.` },
  { status: ['In Transit', 'Tender Accepted'], text: (s) => `Blown tire on ${s.id}, roadside says 6 hrs minimum. Won't make the ${s.del} delivery in ${s.d}.` },
  { status: ['Delivered', 'In Transit'], text: (s) => `${s.id} delivered in ${s.d}, signed by receiver. POD attached.` },
  { status: ['Delivered', 'In Transit'], text: (s) => `Driver sat at the receiver in ${s.d} 4.5 hours past appointment on ${s.id}. Billing 3 hrs detention at $75/hr per the rate con.` },
  { status: ['Tendered'], text: (s) => `Can you do more on ${s.id}? ${s.o} to ${s.d} is tight at this rate, diesel is up.` },
  { status: ['Tender Accepted', 'Tendered'], text: (s) => `we got ${s.id} but might be late depending on the shipper, will update` },
  { status: ['In Transit', 'Tender Accepted'], text: (s) => `Heads up on ${s.id} - consignee in ${s.d} closed early, we will redeliver tomorrow AM. Redelivery fee applies.` },
  { status: ['Tender Accepted', 'Tendered'], text: () => 'ok' },
];

function city(v) { return String(v || '').split(',')[0].trim().replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()); }

router.get('/samples', async (_req, res) => {
  try {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);
    const { data, error } = await sb.from('shipments')
      .select('id,carrier,origin,dest,status,pickup_date,delivery_date')
      .in('status', ['Tendered', 'Tender Accepted', 'In Transit', 'Delivered'])
      .not('carrier', 'is', null).neq('carrier', '')
      .order('updated_at', { ascending: false }).limit(400);
    if (error) throw error;
    const used = new Set(); const usedCarriers = new Set(); const out = [];
    for (const t of SAMPLE_TEMPLATES) {
      const pick = (preferNewCarrier) => data.find((r) => !used.has(r.id) && t.status.includes(r.status)
        && (!preferNewCarrier || !usedCarriers.has(r.carrier)));
      const row = pick(true) || pick(false) || data.find((r) => !used.has(r.id));
      if (!row) break;
      used.add(row.id); usedCarriers.add(row.carrier);
      const s = { id: row.id, o: city(row.origin), d: city(row.dest), pu: row.pickup_date, del: row.delivery_date };
      out.push({ shipmentRef: row.id, carrier: row.carrier, status: row.status,
        lane: `${row.origin} -> ${row.dest}`, deliveryDate: row.delivery_date, message: t.text(s) });
    }
    res.json({ samples: out });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Carrier recommendation. Zoree supplies eligible carriers + rates and
// live history from the shipments table; Jev judges best fit. Zoree still
// computes the premium and decides auto vs planner. Never tenders.
//   POST /api/jev/recommend { order, options:[{carrier,rate,transitDays}], facts:{urgent, declines:{carrier:n}} }
router.post('/recommend', async (req, res) => {
  const { order = {}, options = [], facts = {} } = req.body || {};
  if (!Array.isArray(options) || options.length < 2) return res.status(400).json({ error: 'at least 2 options required' });
  try {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);
    const { data } = await sb.from('shipments').select('carrier,status,delivery_date,delivered_at')
      .in('carrier', options.map((o) => o.carrier)).limit(5000);
    const hist = {};
    for (const r of data || []) {
      const h = hist[r.carrier] || (hist[r.carrier] = { loads: 0, delivered: 0, onTime: 0 });
      h.loads += 1;
      if (r.status === 'Delivered') {
        h.delivered += 1;
        if (r.delivered_at && r.delivery_date && String(r.delivered_at).slice(0, 10) <= r.delivery_date) h.onTime += 1;
      }
    }
    const declines = facts.declines || {};
    const enriched = options.map((o, i) => {
      const h = hist[o.carrier] || { loads: 0, delivered: 0, onTime: 0 };
      return { ...o, key: `c${i + 1}`, loads: h.loads, delivered: h.delivered,
        onTimePct: h.delivered ? Math.round((h.onTime / h.delivered) * 100) : null,
        recentDeclines: Number(declines[o.carrier] || 0) };
    });
    const cheapest = enriched.reduce((a, b) => (b.rate < a.rate ? b : a));
    const lines = enriched.map((o) => `${o.key}: ${o.carrier} | $${o.rate} | transit ${o.transitDays} days | ${o.loads} loads with us | on-time ${o.onTimePct == null ? 'no delivered history' : o.onTimePct + '% of ' + o.delivered + ' delivered'} | declined our tenders ${o.recentDeclines} times in the last 30 days on this lane`);
    const state = [
      `Order ${order.id || ''}: ${order.lane || ''}, ${order.weight || ''}, ready ${order.ready || ''}, delivery due ${order.due || ''}.`,
      facts.urgent ? 'Customer note: delivery is urgent, a late delivery incurs a penalty and risks the account.' : 'Customer note: standard delivery, cost is the main priority.',
      'Eligible carriers (already filtered for equipment, lane and capacity):',
      ...lines,
    ].join('\n');
    const criteria = {};
    for (const o of enriched) criteria[o.key] = `${o.carrier}, $${o.rate}, ${o.transitDays}-day transit`;
    const questions = {
      best_carrier: { type: 'choice', instructions: 'Which eligible carrier is the best fit for this shipment, weighing cost, transit time against the due date, reliability history and recent tender declines', criteria },
      cheapest_is_safe: { type: 'noul', instructions: `The cheapest carrier (${cheapest.carrier}) is likely to accept the tender and deliver on time` },
      premium_justified: { type: 'noul', instructions: 'Paying more than the cheapest rate is justified for this shipment' },
    };
    const r = await jev.systemOne(state, questions);
    const a = r.answers;
    const pick = enriched.find((o) => o.key === a.best_carrier.choice) || cheapest;
    const confidence = a.best_carrier.confidence;
    const premium = pick.rate - cheapest.rate;
    const cap = Number(facts.premiumCap ?? 150);
    const route = confidence >= 0.8 && premium <= cap ? 'AUTO_RECOMMEND' : 'PLANNER_REVIEW';
    res.json({
      pick: pick.carrier, pickRate: pick.rate, cheapest: cheapest.carrier, cheapestRate: cheapest.rate, premium, premiumCap: cap,
      confidence, route,
      probabilities: Object.fromEntries(enriched.map((o) => [o.carrier, a.best_carrier.probabilities?.[o.key] ?? 0])),
      cheapestIsSafe: a.cheapest_is_safe?.noul, premiumJustified: a.premium_justified?.noul,
      carriers: enriched, latencyMs: r.latencyMs, model: r.model,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Bulk-plan: Zoree builds feasible plans, Jev chooses. With orderIds (sent by
// "Plan with Jev" on the Orders screen) it plans those orders; without, the
// default 10-order demo lane.
//   POST /api/jev/bulk-plan { kllmUnavailable, orderIds? }
router.post('/bulk-plan', async (req, res) => {
  try {
    const { runBulkPlanLive } = require('../services/ai/bulkPlanLive');
    const { cleanOrderIds } = require('../services/ai/bulkPlanSelection');
    // Toggle removes the carrier the plan currently relies on most (cheapest), default KLLM.
    res.json(await runBulkPlanLive({
      excludeCarrier: req.body?.kllmUnavailable ? (req.body?.excludeCarrier || 'KLLM TRANSPORT') : null,
      orderIds: cleanOrderIds(req.body?.orderIds),
    }));
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// Bulk-plan at scale: 1,000 synthetic orders, Zoree packs/prices, Jev picks per lane cluster.
//   POST /api/jev/bulk-plan-1000
router.post('/bulk-plan-1000', async (_req, res) => {
  try {
    const { runBulkPlan1000 } = require('../services/ai/bulkPlan1000');
    res.json(await runBulkPlan1000());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
