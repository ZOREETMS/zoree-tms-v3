// Unit tests for the AI agents' pure logic (no DB, no network).
'use strict';
const test = require('node:test');
const assert = require('node:assert');

const pricing = require('../services/agents/quote/quotePricing');
const scoring = require('../services/agents/carrierSourcing/carrierScoring');
const eta = require('../services/agents/trackTrace/etaRisk');
const audit = require('../services/agents/freightAudit/auditRules');
const podMatch = require('../services/agents/pod/podMatching');
const policies = require('../services/agents/agentPolicies');
const runner = require('../services/agents/agentRunner');
const { priceTlRate, parsePlace } = require('../services/rating/tlQuoteService');
const { callTool } = require('../services/agents/llm/claudeTool');

// ── Rating ─────────────────────────────────────────────────────────
test('priceTlRate matches the bulk-plan rounding', () => {
  assert.deepStrictEqual(priceTlRate({ rpm: 2.45, miles: 920, fscPct: 22.5 }), { base: 2254, fsc: 507, total: 2761 });
  assert.deepStrictEqual(priceTlRate({ rpm: 2, miles: 100, fscPct: 0 }), { base: 200, fsc: 0, total: 200 });
});

test('parsePlace splits city, state, zip', () => {
  assert.deepStrictEqual(parsePlace('Chicago, IL 60632'), { city: 'CHICAGO', state: 'IL', zip: '60632' });
  assert.deepStrictEqual(parsePlace('Dallas, TX'), { city: 'DALLAS', state: 'TX', zip: null });
});

// ── Quote ──────────────────────────────────────────────────────────
test('applyMargin uses % with a dollar floor and rounds up to $5', () => {
  assert.deepStrictEqual(pricing.applyMargin(2679, { pct: 15, minUsd: 150 }), { cost: 2679, sell: 3085, marginUsd: 406, marginPct: 15.2 });
  assert.strictEqual(pricing.applyMargin(500, { pct: 15, minUsd: 150 }).sell, 650); // floor wins
});

test('pickOptions keeps the cheapest quote per carrier', () => {
  const q = [{ carrier: 'A', total: 1 }, { carrier: 'A', total: 2 }, { carrier: 'B', total: 3 }, { carrier: 'C', total: 4 }, { carrier: 'D', total: 5 }];
  assert.deepStrictEqual(pricing.pickOptions(q).map((x) => x.carrier), ['A', 'B', 'C']);
});

test('quote email hides carrier and cost, shows sell and validity', () => {
  const { body, subject } = pricing.buildQuoteEmail({
    contactName: 'Maria Lopez', subject: 'RFQ Chicago to Dallas',
    lanes: [{ origin: 'Chicago, IL', dest: 'Dallas, TX', weight: 38000, sell: 3085, cost: 2679, carrier: 'KLLM TRANSPORT', transitDays: 2 }],
    validUntil: '2026-11-01', diesel: { week: '2026-10-19', price: 6.276 },
  });
  assert.match(subject, /^RE: RFQ Chicago to Dallas/);
  assert.match(body, /Hi Maria,/);
  assert.match(body, /\$3,085/);
  assert.doesNotMatch(body, /KLLM|2,679/);
  assert.match(body, /valid through 2026-11-01/);
});

// ── Carrier sourcing ───────────────────────────────────────────────
const carriers = [
  { id: '1', name: 'WERNER ENTERPRISES', mode: 'TL', status: 'Active', max_weight: 45000, on_time_pct: 96.2, claim_ratio: 0.8 },
  { id: '2', name: 'KLLM TRANSPORT', mode: 'TL', status: 'Active', max_weight: 45000, on_time_pct: 95, claim_ratio: 0.5 },
  { id: '3', name: 'XPO LOGISTICS', mode: 'LTL', status: 'Active', max_weight: 20000, on_time_pct: 95.3, claim_ratio: 0.9 },
  { id: '4', name: 'SWIFT TRANSPORTATION', mode: 'TL', status: 'Inactive', max_weight: 45000, on_time_pct: 92, claim_ratio: 1.5 },
];

test('eligibleCarriers filters mode, status and weight', () => {
  const e = scoring.eligibleCarriers(carriers, { mode: 'TL', weight: 40000 });
  assert.deepStrictEqual(e.map((c) => c.name), ['WERNER ENTERPRISES', 'KLLM TRANSPORT']);
  assert.strictEqual(scoring.eligibleCarriers(carriers, { mode: 'TL', weight: 50000 }).length, 0);
});

test('scoreCarriers ranks price + service + history and explains why', () => {
  const prices = new Map([['KLLM TRANSPORT', { total: 2679 }], ['WERNER ENTERPRISES', { total: 2761 }]]);
  const history = scoring.laneHistory([{ id: 'x', carrier: 'WERNER ENTERPRISES', origin: 'Joliet, IL', dest: 'Plano, TX' }], { id: 's', origin: 'Chicago, IL', dest: 'Dallas, TX' });
  const ranked = scoring.scoreCarriers(carriers.slice(0, 2), prices, history);
  assert.strictEqual(ranked.length, 2);
  assert.ok(ranked[0].score >= ranked[1].score);
  assert.ok(ranked.find((r) => r.carrier === 'KLLM TRANSPORT').reasons[0].includes('(lowest)'));
  assert.ok(ranked.find((r) => r.carrier === 'WERNER ENTERPRISES').reasons[3].includes('1 past load'));
});

test('no contract rate scores 0 on price and is offered as spot', () => {
  const [r] = scoring.scoreCarriers([carriers[0]], new Map(), new Map());
  assert.strictEqual(r.parts.price, 0);
  assert.match(r.reasons[0], /spot offer/);
  assert.match(scoring.buildLoadOfferEmail({ shipment: { id: 'S1', origin: 'A, IL', dest: 'B, TX', weight: 1000 }, candidate: r }).body, /best all-in rate/);
});

// ── Track & trace ─────────────────────────────────────────────────
test('assessShipment flags missed pickup, past due and silent loads', () => {
  const now = Date.parse('2026-10-25T18:00:00Z');
  const today = '2026-10-25';
  assert.strictEqual(eta.assessShipment({ status: 'Tender Accepted', pickup_date: '2026-10-23' }, { today, now }).code, 'missed_pickup');
  assert.strictEqual(eta.assessShipment({ status: 'In Transit', delivery_date: '2026-10-24' }, { today, now }).code, 'past_due');
  assert.strictEqual(eta.assessShipment({ status: 'In Transit', delivery_date: '2026-10-26', updated_at: '2026-10-24T08:00:00Z' }, { today, now }).code, 'eta_risk');
  assert.strictEqual(eta.assessShipment({ status: 'In Transit', delivery_date: '2026-10-28', updated_at: '2026-10-25T08:00:00Z' }, { today, now }).level, 'ok');
});

test('inWindow ignores loads older than the lookback', () => {
  assert.ok(eta.inWindow({ status: 'In Transit', delivery_date: '2026-10-20' }, { today: '2026-10-25', lookbackDays: 14 }));
  assert.ok(!eta.inWindow({ status: 'In Transit', delivery_date: '2026-04-23' }, { today: '2026-10-25', lookbackDays: 14 }));
});

// ── Freight audit ─────────────────────────────────────────────────
const ship = { id: 'SHP-1', status: 'Delivered', rate: 2254, fuel_surcharge: 507, accessorials: 0, total_cost: 2761 };

test('audit catches fuel overbill and unapproved accessorial', () => {
  const expected = audit.expectedCharges([ship]);
  const r = audit.auditInvoice({
    invoice: { id: 'INV-1', invoiced_amount: 3437 },
    lines: [
      { cost_type: 'base', invoice_cost: 2254 },
      { cost_type: 'fuel_surcharge', invoice_cost: 676 },
      { cost_type: 'accessorial', description: 'Detention 3 hrs', invoice_cost: 225 },
      { cost_type: 'accessorial', description: 'Lumper', invoice_cost: 282 },
    ],
    shipments: [ship], siblings: [], expected,
  });
  assert.strictEqual(r.verdict, 'dispute');
  assert.deepStrictEqual(r.issues.map((i) => i.code), ['fuel_over', 'accessorial_unapproved']);
  assert.strictEqual(r.recoverable, 676);
  assert.strictEqual(r.payAmount, 2761);
});

test('audit holds a duplicate invoice in full', () => {
  const r = audit.auditInvoice({ invoice: { id: 'INV-2', invoiced_amount: 2761 }, lines: [], shipments: [ship], siblings: [{ id: 'INV-1', invoice_number: 'INV-77', status: 'Approved' }], expected: audit.expectedCharges([ship]) });
  assert.strictEqual(r.issues[0].code, 'duplicate_invoice');
  assert.strictEqual(r.recoverable, 2761);
  assert.strictEqual(r.payAmount, 0);
});

test('EIA bracket overrides the shipment fuel snapshot', () => {
  const e = audit.expectedCharges([ship], { eiaFscPct: 20 });
  assert.strictEqual(e.fuel, 450.8);
  assert.strictEqual(e.fuelSource, 'eia');
});

test('clean invoice is approved; unlinked invoice needs data', () => {
  assert.strictEqual(audit.auditInvoice({ invoice: { invoiced_amount: 2761 }, lines: [], shipments: [ship], siblings: [], expected: audit.expectedCharges([ship]) }).verdict, 'approve');
  assert.strictEqual(audit.auditInvoice({ invoice: { invoiced_amount: 100 }, lines: [], shipments: [], siblings: [], expected: audit.expectedCharges([]) }).verdict, 'needs_data');
});

// ── POD ───────────────────────────────────────────────────────────
test('POD matching and piece-count exception', () => {
  const s = { id: 'SHP-9', bol_number: 'BOL-SHP-9', pro_number: 'PRO9', pieces: 24 };
  assert.strictEqual(podMatch.matchReference({ references: { bol_number: 'bol-shp-9' } }, s), 'bol_number');
  assert.strictEqual(podMatch.matchReference({ references: { pro_number: 'X' } }, s), null);
  const ex = podMatch.deliveryExceptions({ pieces_delivered: 22, exceptions: [] }, s);
  assert.deepStrictEqual(ex.map((e) => [e.type, e.pieces]), [['shortage', 2]]);
  assert.strictEqual(podMatch.deliveryExceptions({ pieces_delivered: 22, exceptions: [{ type: 'shortage', detail: '2 short', pieces: 2 }] }, s).length, 1);
});

// ── Framework ─────────────────────────────────────────────────────
test('policy defaults to confirm; env can raise to auto or forbid', () => {
  assert.strictEqual(policies.tierFor('SEND_QUOTE', {}), 'confirm');
  assert.strictEqual(policies.tierFor('SEND_CHECK_CALL', { AGENT_POLICY_SEND_CHECK_CALL: 'auto' }), 'auto');
  assert.strictEqual(policies.tierFor('SEND_QUOTE', { AGENT_POLICY_SEND_QUOTE: 'yolo' }), 'confirm');
});

test('runner keeps only declared editable fields', () => {
  const mod = { editableFields: { SEND_QUOTE: ['subject', 'body'] } };
  const merged = runner.mergeEdits(mod, { action_type: 'SEND_QUOTE', payload: { to: 'a@b.c', subject: 's', lanes: [1] } }, { subject: 'new', to: 'evil@x.com' });
  assert.deepStrictEqual(merged, { to: 'a@b.c', subject: 'new', lanes: [1], _edited: ['subject'] });
});

test('idempotency key is stable per agent/action/entity/dedupe', () => {
  const k = runner.idempotencyKeyFor('quote', { type: 'SEND_QUOTE', entityId: 'x@y.com', dedupe: 'L1' });
  assert.strictEqual(k, 'quote:SEND_QUOTE:x@y.com:L1');
});

test('callTool returns the tool input and surfaces API errors', async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test';
  const tool = { name: 't', description: 'd', input_schema: { type: 'object', properties: {} } };
  const ok = async () => ({ ok: true, text: async () => JSON.stringify({ model: 'm', usage: { input_tokens: 3 }, content: [{ type: 'tool_use', name: 't', input: { a: 1 } }] }) });
  assert.deepStrictEqual((await callTool({ system: 's', content: 'c', tool, fetchImpl: ok })).input, { a: 1 });
  const err = async () => ({ ok: false, status: 429, text: async () => JSON.stringify({ error: { type: 'rate_limit', message: 'slow down' } }) });
  await assert.rejects(callTool({ system: 's', content: 'c', tool, fetchImpl: err }), /429: rate_limit: slow down/);
  process.env.ANTHROPIC_API_KEY = prev;
});

test('audit never approves an invoice for freight that is not delivered', () => {
  const r = audit.auditInvoice({ invoice: { invoiced_amount: 2761 }, lines: [], shipments: [{ ...ship, status: 'Tendered' }], siblings: [], expected: audit.expectedCharges([ship]) });
  assert.strictEqual(r.verdict, 'hold');
  assert.strictEqual(r.issues[0].code, 'not_delivered');
  assert.strictEqual(r.payAmount, 0);
});
