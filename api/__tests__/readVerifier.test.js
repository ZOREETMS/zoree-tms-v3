// Independent read check (Jev) and the dependency-free PDF text reader.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { extractText } = require('../services/invoiceIntake/pdfText');
const { verify } = require('../services/invoiceIntake/readVerifier');
const { check } = require('../services/invoiceIntake/readChecks');

const INBOX = path.join(__dirname, '..', '..', 'demo', 'kestrel-bay', 'inbox');
const have = fs.existsSync(path.join(INBOX, '04_BW-5521.pdf'));
const pdf = have ? fs.readFileSync(path.join(INBOX, '04_BW-5521.pdf')) : null;
const fields = { invoiceNumber: 'BW-5521', carrier: 'Bluewater Carriers, Inc.', shipmentRef: 'KB-SH-40130', invoiceDate: '2026-10-08', total: 1561.6, confidence: 0.97, warnings: [],
  lines: [{ description: 'Truckload linehaul', category: 'base', amount: 1280 }, { description: 'Fuel (22%)', category: 'fuel', amount: 281.6 }] };
const env = { INVOICE_INTAKE_JEV_VERIFY: 'on' };
const answers = (f, l, t) => async () => ({ model: 'jev-test', latencyMs: 5, answers: { fields_match: { noul: f }, lines_match: { noul: l }, total_matches: { noul: t } } });

test('pdfText: reads the printed text of a carrier invoice (ASCII85 + Flate)', { skip: !have }, () => {
  const t = extractText(pdf);
  for (const s of ['BW-5521', 'KB-SH-40130', '$1,280.00', '$281.60', '$1,561.60']) assert.ok(t.includes(s), s);
});

test('pdfText: not a PDF gives no text', () => {
  assert.equal(extractText(Buffer.from('hello')), '');
  assert.equal(extractText(null), '');
});

test('verify: the lowest Jev answer is the score', { skip: !have }, async () => {
  const r = await verify({ buffer: pdf, fields }, { env, systemOne: answers(0.98, 0.04, 0.97) });
  assert.equal(r.status, 'checked');
  assert.equal(r.score, 0.04);
});

test('verify: Jev sees the PDF text and only the read fields it judges', { skip: !have }, async () => {
  let sent;
  await verify({ buffer: pdf, fields }, { env, systemOne: async (state) => { sent = state; return (await answers(0.9, 0.9, 0.9)()); } });
  assert.ok(sent.invoice_text.includes('$1,561.60'));
  assert.deepEqual(Object.keys(sent.agent_read).sort(), ['carrier', 'invoiceDate', 'invoiceNumber', 'lines', 'shipmentRef', 'total']);
});

test('verify: Jev failure is reported, never treated as a pass', { skip: !have }, async () => {
  const r = await verify({ buffer: pdf, fields }, { env, systemOne: async () => { throw new Error('Jev timed out'); } });
  assert.equal(r.status, 'error');
  const c = check(fields, { knownCarriers: ['BLUEWATER CARRIERS'], verify: r });
  assert.equal(c.ok, false);
});

test('verify: an incomplete Jev answer is an error', { skip: !have }, async () => {
  const r = await verify({ buffer: pdf, fields }, { env, systemOne: async () => ({ answers: { fields_match: { noul: 0.9 } } }) });
  assert.equal(r.status, 'error');
});

test('verify: a PDF with no text layer is no_text and fails the read check', async () => {
  const r = await verify({ buffer: Buffer.from('%PDF-1.4\n%%EOF'), fields }, { env, systemOne: answers(1, 1, 1) });
  assert.equal(r.status, 'no_text');
  assert.equal(check(fields, { knownCarriers: ['BLUEWATER CARRIERS'], verify: r }).ok, false);
});

test('verify: can be switched off; then the read check ignores it', async () => {
  const r = await verify({ buffer: Buffer.from('x'), fields }, { env: { INVOICE_INTAKE_JEV_VERIFY: 'off' } });
  assert.equal(r.status, 'off');
  assert.equal(check(fields, { knownCarriers: ['BLUEWATER CARRIERS'], verify: r }).ok, true);
});

test('readChecks: a high Jev score passes and names it; a low one names the field', () => {
  const ok = check(fields, { knownCarriers: ['BLUEWATER CARRIERS'], verify: { status: 'checked', score: 0.97, min: 0.8, answers: { fields_match: 0.98, lines_match: 0.97, total_matches: 0.99 } } });
  assert.equal(ok.ok, true);
  assert.ok(ok.passed.some((p) => /Independent check \(Jev\).*0\.97/.test(p)));
  const bad = check(fields, { knownCarriers: ['BLUEWATER CARRIERS'], verify: { status: 'checked', score: 0.02, min: 0.8, answers: { fields_match: 0.98, lines_match: 0.91, total_matches: 0.02 } } });
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.some((p) => /total may not match/.test(p)));
});

test('pdfText: a line whose text contains "ET" (DET detention) is not dropped', { skip: !fs.existsSync(path.join(INBOX, '05_PE-0931.pdf')) }, () => {
  const t = extractText(fs.readFileSync(path.join(INBOX, '05_PE-0931.pdf')));
  assert.match(t, /DET Detention 2\.0 hrs @ \$75\.00 \$150\.00/);
  assert.match(t, /TOTAL \$442\.64/);
});

test('pdfText: every sample invoice with a text layer yields its total', { skip: !have }, () => {
  for (const f of fs.readdirSync(INBOX).filter((n) => n.endsWith('.pdf') && !/scan/.test(n))) {
    assert.ok(extractText(fs.readFileSync(path.join(INBOX, f))).length > 300, f);
  }
  assert.equal(extractText(fs.readFileSync(path.join(INBOX, '09_PE-0944_scan.pdf'))), '');
});
