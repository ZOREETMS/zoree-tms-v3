// Invoice PDF intake orchestration — collaborators stubbed via require cache.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const S = (rel) => path.join(__dirname, '..', 'services', rel);
function stub(rel, exports) { const id = require.resolve(S(rel)); require.cache[id] = { id, filename: id, loaded: true, exports }; }

const calls = [];
let lastMeta = null;
let extracted; let existingInvoices; let priorByHash; let tolerance; let lineAudit;
stub('supabase.js', {
  dbSelect: async (table, q) => {
    if (table === 'carriers') return [{ name: 'RIDGELINE FREIGHT' }, { name: 'PIONEER EXPRESS', contact_email: 'ar@pioneerexpress.com' }];
    if (table === 'invoices') { const [col, , val] = q.filters[0]; return existingInvoices.filter((r) => (col === 'id' ? r.id : r.invoice_number) === val); }
    return [];
  },
});
stub('invoiceAudit.js', {
  submitInvoice: async (a) => { calls.push(['submit', a.deferApSend]); lastMeta = a.metadata; return { invoice: { id: 'INV-9', invoiced_amount: a.invoicedAmount, tenant_id: null }, decision: { status: tolerance } }; },
  sendToAp: async () => { calls.push(['sendToAp']); },
  manualDecide: async (a) => { calls.push(['manualDecide', a.decision]); },
});
stub('invoiceCostLines.js', { replaceForInvoice: async (a) => { calls.push(['lines', a.lines.map((l) => l.accessorial_type || l.cost_type)]); } });
stub('agents/freightAudit/index.js', { auditOne: async () => ({ audit: lineAudit }) });
stub('invoiceIntake/pdfExtractor.js', { extract: async () => ({ fields: extracted, model: 'test-model' }) });
let verifyResult = null;
let lastRow = null;
stub('invoiceIntake/readVerifier.js', { verify: async () => verifyResult });
stub('invoiceIntake/intakeRepository.js', {
  findCreatedByHash: async () => priorByHash,
  record: async (row) => { lastRow = row; return { id: 'IN-1', ...row }; },
  listRecent: async () => [],
});
process.env.FREIGHT_AUDIT_SHADOW_MODE = 'off'; // tests must not depend on today's date
const svc = require('../services/invoiceIntake/intakeService');

const good = {
  invoiceNumber: 'PE-0931', carrier: 'PIONEER EXPRESS LTL', shipmentRef: 'SHP-1', invoiceDate: '2026-10-10', proNumber: 'PEX-1',
  total: 442.64, confidence: 0.97, warnings: [],
  lines: [
    { description: 'Freight', category: 'base', accessorialType: null, hours: null, amount: 236 },
    { description: 'Fuel', category: 'fuel', accessorialType: null, hours: null, amount: 56.64 },
    { description: 'Detention 2 hrs', category: 'accessorial', accessorialType: 'detention', hours: 2, amount: 150 },
  ],
};
const okLines = async (a) => { calls.push(['lines', a.lines.map((l) => l.accessorial_type || l.cost_type)]); };
const reset = () => { require.cache[require.resolve(S('invoiceCostLines.js'))].exports.replaceForInvoice = okLines; calls.length = 0; extracted = JSON.parse(JSON.stringify(good)); existingInvoices = []; priorByHash = null; tolerance = 'Approved'; lineAudit = { verdict: 'approve', issues: [], passed: ['Detention approved'] }; verifyResult = { status: 'checked', score: 0.97, min: 0.8, answers: { fields_match: 0.98, lines_match: 0.97, total_matches: 0.99 } }; lastRow = null; };
const run = () => svc.intakePdf({ fileName: 'pe.pdf', buffer: Buffer.from('%PDF-1.4 test'), user: { email: 'ap@x.com' } });

test('clean PDF: created, lines typed, line-audited, then sent to AP', async () => {
  reset();
  const r = await run();
  assert.equal(r.status, 'created');
  assert.equal(r.sentToAp, true);
  assert.deepEqual(calls, [['submit', true], ['lines', ['base', 'fuel_surcharge', 'detention']], ['sendToAp']]);
});

test('within tolerance but line audit finds a problem: On Hold, not sent to AP', async () => {
  reset();
  lineAudit = { verdict: 'dispute', issues: [{ detail: 'Liftgate $85.00 billed, but there is no liftgate approval on the shipment.' }], passed: [] };
  const r = await run();
  assert.equal(r.invoiceStatus, 'On Hold');
  assert.equal(r.sentToAp, false);
  assert.deepEqual(calls.at(-1), ['manualDecide', 'On Hold']);
});

test('beyond tolerance: the agent holds it for AP, it never rejects', async () => {
  reset();
  tolerance = 'Rejected';
  lineAudit = { verdict: 'review', issues: [{ detail: 'Base $1,280.00 billed, contract $1,180.00.' }], passed: [] };
  const r = await run();
  assert.equal(r.status, 'created');
  assert.equal(r.invoiceStatus, 'On Hold');
  assert.equal(r.sentToAp, false);
  assert.match(r.summary, /^Needs AP review: .*contract \$1,180\.00/);
  assert.deepEqual(calls.at(-1), ['manualDecide', 'On Hold']);
});

test('bad read (lines do not add up): nothing created, needs manual entry', async () => {
  reset();
  extracted.total = 999;
  const r = await run();
  assert.equal(r.status, 'needs_manual');
  assert.equal(calls.length, 0);
});

test('same invoice number from same carrier: duplicate, nothing created', async () => {
  reset();
  existingInvoices = [{ id: 'INV-1', invoice_number: 'PE-0931', carrier: 'PIONEER EXPRESS', status: 'Approved' }];
  const r = await run();
  assert.equal(r.status, 'duplicate');
  assert.equal(r.duplicateOfInvoiceId, 'INV-1');
  assert.equal(calls.length, 0);
});

test('exact same PDF again: duplicate before any model call', async () => {
  reset();
  priorByHash = { invoice_id: 'INV-1', file_name: 'pe.pdf' };
  existingInvoices = [{ id: 'INV-1', invoice_number: 'PE-0931' }];
  const r = await run();
  assert.equal(r.status, 'duplicate');
  assert.equal(calls.length, 0);
});

test('lines fail after create: invoice parked On Hold, intake failed', async () => {
  reset();
  require.cache[require.resolve(S('invoiceCostLines.js'))].exports.replaceForInvoice = async () => { throw new Error('boom'); };
  const r = await run();
  assert.equal(r.status, 'failed');
  assert.deepEqual(calls.at(-1), ['manualDecide', 'On Hold']);
});

const viaEmail = (sender, senderAuth = null, carrier = 'PIONEER EXPRESS LTL') => {
  extracted.carrier = carrier;
  return svc.intakePdf({ fileName: 'pe.pdf', buffer: Buffer.from(`%PDF-1.4 ${sender}${carrier}`), user: { email: 'agent' }, source: 'email', sender, senderAuth });
};

test('email from the carrier domain on file: audited and sent to AP', async () => {
  reset();
  const r = await viaEmail('billing@pioneerexpress.com', { dmarc: 'pass', dkim: 'pass', spf: 'pass' });
  assert.equal(r.status, 'created');
  assert.equal(r.sentToAp, true);
  assert.equal(lastMeta.intake.sender_verification, 'verified');
});

test('look-alike sender domain: still audited, but held — never auto-approved', async () => {
  reset();
  const r = await viaEmail('billing@pioneer-express-pay.com');
  assert.equal(r.status, 'created');
  assert.equal(r.invoiceStatus, 'On Hold');
  assert.equal(r.sentToAp, false);
  assert.match(r.summary, /audit passed, but the sender is not verified.*on file as pioneerexpress\.com/);
  assert.equal(lastMeta.intake.sender_verification, 'unverified');
  assert.deepEqual(calls.at(-1), ['manualDecide', 'On Hold']);
});

test('right domain but DMARC failed: held as a possibly forged From address', async () => {
  reset();
  const r = await viaEmail('billing@pioneerexpress.com', { dmarc: 'fail' });
  assert.equal(r.invoiceStatus, 'On Hold');
  assert.match(r.summary, /failed DMARC/);
});

test('carrier with no billing email on file: audited, held until the sender is verified', async () => {
  reset();
  const r = await viaEmail('ap@ridgeline.com', null, 'RIDGELINE FREIGHT');
  assert.equal(r.status, 'created');
  assert.equal(r.invoiceStatus, 'On Hold');
  assert.equal(lastMeta.intake.sender_verification, 'unregistered');
});

test('uploaded PDF: no sender check, clean invoice goes to AP', async () => {
  reset();
  const r = await run();
  assert.equal(r.sentToAp, true);
  assert.equal(lastMeta.intake.sender_verification, 'not_checked');
});

test('carrier not on file: nothing created, carrier onboarding needed', async () => {
  reset();
  extracted.carrier = 'NEWCO TRUCKING';
  const r = await run();
  assert.equal(r.status, 'needs_manual');
  assert.match(r.summary, /carrier onboarding/);
});

test('change freeze (shadow mode): a clean invoice is recommended, never released', async () => {
  reset();
  process.env.FREIGHT_AUDIT_SHADOW_MODE = 'on';
  try {
    const r = await run();
    assert.equal(r.invoiceStatus, 'On Hold');
    assert.equal(r.sentToAp, false);
    assert.match(r.summary, /Shadow mode/);
  } finally { process.env.FREIGHT_AUDIT_SHADOW_MODE = 'off'; }
});

test('Jev independent check: a low score sends the invoice to a person, nothing created', async () => {
  reset();
  verifyResult = { status: 'checked', score: 0.04, min: 0.8, answers: { fields_match: 0.97, lines_match: 0.04, total_matches: 0.98 } };
  const r = await run();
  assert.equal(r.status, 'needs_manual');
  assert.ok(!calls.some((c) => c[0] === 'submit'), 'no invoice created');
  assert.ok(lastRow.problems.some((p) => /Jev\) scored the read 0\.04.*charge lines/.test(p)));
});

test('Jev independent check: unreachable means a person keys it (fails closed)', async () => {
  reset();
  verifyResult = { status: 'error', min: 0.8, detail: 'Jev timed out after 8000ms' };
  const r = await run();
  assert.equal(r.status, 'needs_manual');
  assert.ok(lastRow.problems.some((p) => /could not run \(Jev timed out/.test(p)));
});

test('Jev independent check: a scan with no text layer goes to a person', async () => {
  reset();
  verifyResult = { status: 'no_text', min: 0.8, detail: 'no text' };
  const r = await run();
  assert.equal(r.status, 'needs_manual');
});

test('Jev independent check: the score is kept with the read for AP to see', async () => {
  reset();
  const r = await run();
  assert.equal(r.status, 'created');
  assert.equal(lastRow.raw_extraction.verify.score, 0.97);
});
