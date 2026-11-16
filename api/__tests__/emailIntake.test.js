// Email order agent — pure mapping/validation + extractor request shape.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const svc = require('../services/emailIntake/intakeService');
const extractor = require('../services/emailIntake/extractor');
const { apiOrderToDbPatch } = require('../services/orderMutations');

const draft = {
  customer: 'CISCO',
  po_number: 'PO-77812',
  reference_number: 'SO-5531',
  ship_from: { name: 'San Jose DC', street: '170 W Tasman Dr', city: 'San Jose', state: 'CA', zip: '95134', country: null },
  ship_to: { name: 'Dallas Hub', street: '2200 Main St', city: 'Dallas', state: 'TX', zip: '75201', country: 'US' },
  ready_date: '2026-10-28', due_date: '2026-11-02',
  ship_mode: 'LTL', service_level: 'expedited', commodity: 'Network switches',
  weight_lbs: 2400, pieces: 4, hazmat: false,
  special_instructions: 'Liftgate at delivery',
  lines: [
    { description: 'Catalyst 9300', item_id: 'C9300-48P', qty: 20, unit_weight_lbs: 60, total_weight_lbs: null },
    { description: 'Pallet', item_id: null, qty: 4, unit_weight_lbs: 50, total_weight_lbs: 200 },
  ],
  assumptions: [],
};

test('composeLocation matches existing TMS format', () => {
  assert.strictEqual(svc.composeLocation(draft.ship_from), 'San Jose, CA 95134');
  assert.strictEqual(svc.composeLocation({ city: 'Shenzhen', country: 'China' }), 'Shenzhen, China');
  assert.strictEqual(svc.composeLocation({ zip: '75201' }), '75201');
  assert.strictEqual(svc.composeLocation({}), null);
});

test('draftToOrderBody → apiOrderToDbPatch produces the DB columns', () => {
  const body = svc.draftToOrderBody(draft, { subject: 'New PO 77812', fromAddress: 'ops@cisco.com' });
  const patch = apiOrderToDbPatch(body);
  assert.strictEqual(patch.customer, 'CISCO');
  assert.strictEqual(patch.origin, 'SAN JOSE, CA 95134');
  assert.strictEqual(patch.dest, 'DALLAS, TX 75201');
  assert.strictEqual(patch.origin_zip, '95134');
  assert.strictEqual(patch.ship_from_name, 'San Jose DC');
  assert.strictEqual(patch.weight, 2400);
  assert.strictEqual(patch.pieces, 4);
  assert.strictEqual(patch.ship_mode, 'LTL');
  assert.strictEqual(patch.service_level, 'Expedited');
  assert.strictEqual(patch.po_number, 'PO-77812');
  assert.strictEqual(patch.ref_num, 'SO-5531');
  assert.strictEqual(patch.ready, '2026-10-28');
  assert.strictEqual(patch.due, '2026-11-02');
  assert.match(patch.notes, /Liftgate/);
  assert.match(patch.notes, /Pickup address: 170 W Tasman Dr/);
  assert.match(patch.notes, /ops@cisco\.com/);
  assert.ok(!('shipment_id' in patch), 'must not touch columns the email did not supply');
});

test('missing fields: required vs recommended', () => {
  assert.deepStrictEqual(svc.missingFor(draft), []);
  const gap = { ...draft, weight_lbs: null, due_date: null, ship_to: { city: null, zip: null } };
  assert.deepStrictEqual(svc.missingFor(gap), ['destination', 'weight', 'due_date']);
  assert.ok(svc.hasRequiredGaps(svc.missingFor(gap)));
  assert.ok(!svc.hasRequiredGaps(['ready_date', 'due_date']));
  assert.deepStrictEqual(svc.rowMissing([draft, gap]), ['order2.destination', 'order2.weight', 'order2.due_date']);
  assert.ok(svc.hasRequiredGaps(['order2.weight']));
});

test('draftLines maps to orderLines.buildLines input', () => {
  const { buildLines } = require('../services/orderLines');
  const built = buildLines('ORD-1', svc.draftLines(draft));
  assert.strictEqual(built.lines.length, 2);
  assert.strictEqual(built.lines[0].total_weight, 1200);
  assert.strictEqual(built.lines[1].total_weight, 200);
  assert.strictEqual(built.lines[0].item_id, 'C9300-48P');
});

test('extractor sends the extraction tool and attaches PDFs, skips unknown types', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  let sent;
  const fetchImpl = async (url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, text: async () => JSON.stringify({ model: 'm', usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'tool_use', name: 'record_order_extraction', input: { is_order_request: true, is_order_confidence: 0.95, reason: 'r', orders: [draft], questions_for_sender: [] } }] }) };
  };
  const out = await extractor.extractOrderFromEmail({
    fromAddress: 'ops@cisco.com', subject: 'PO', receivedAt: '2026-10-26T10:00:00Z', text: 'Please ship',
    attachments: [
      { filename: 'po.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-1.4') },
      { filename: 'sheet.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content: Buffer.from('x') },
    ],
  }, { fetchImpl, knownCustomers: ['CISCO'] });
  assert.deepStrictEqual(sent.tool_choice, { type: 'auto' });
  assert.strictEqual(sent.tools[0].name, 'record_order_extraction');
  assert.ok(sent.messages[0].content.some((b) => b.type === 'document'));
  assert.match(sent.system, /untrusted/);
  assert.match(sent.system, /CISCO/);
  assert.deepStrictEqual(out.skippedAttachments, ['sheet.xlsx (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet not read)']);
  assert.strictEqual(out.result.orders[0].po_number, 'PO-77812');
});

test('htmlToText keeps table cells and line breaks', () => {
  const t = extractor.htmlToText('<p>Ship</p><table><tr><td>PO</td><td>123</td></tr></table><style>x{}</style>');
  assert.match(t, /Ship/);
  assert.match(t, /PO\s+123/);
  assert.doesNotMatch(t, /x\{\}/);
});

test('normalizeResult repairs stringified arrays and booleans', () => {
  const r = extractor.normalizeResult({
    is_order_request: 'true', is_order_confidence: '0.9', reason: 'x',
    orders: JSON.stringify([{ customer: 'CISCO', ship_from: JSON.stringify({ city: 'San Jose' }), lines: '[]', hazmat: 'false', assumptions: [] }]),
    questions_for_sender: '["a"]',
  });
  assert.strictEqual(r.is_order_request, true);
  assert.strictEqual(r.orders.length, 1);
  assert.strictEqual(r.orders[0].ship_from.city, 'San Jose');
  assert.strictEqual(r.orders[0].hazmat, false);
  assert.deepStrictEqual(r.questions_for_sender, ['a']);
});

test('extractor retries once when it says order but returns no drafts', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  let calls = 0;
  const reply = (orders) => ({ ok: true, text: async () => JSON.stringify({ model: 'm', usage: { input_tokens: 5, output_tokens: 1 },
    content: [{ type: 'tool_use', name: 'record_order_extraction', input: { is_order_request: true, is_order_confidence: 0.9, reason: 'r', orders, questions_for_sender: [] } }] }) });
  const fetchImpl = async () => { calls++; return calls === 1 ? reply('not json') : reply([draft]); };
  const out = await extractor.extractOrderFromEmail({ text: 'x', attachments: [] }, { fetchImpl });
  assert.strictEqual(calls, 2);
  assert.strictEqual(out.attempts, 2);
  assert.strictEqual(out.result.orders.length, 1);
  assert.strictEqual(out.usage.input_tokens, 10);
});
