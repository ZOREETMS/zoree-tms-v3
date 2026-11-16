'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const routing = require('../services/emailIntake/invoiceRouting');
const extractor = require('../services/emailIntake/extractor');

test('only PDF attachments are routed', () => {
  const email = { attachments: [
    { filename: 'inv.pdf', contentType: 'application/pdf', content: Buffer.from('x') },
    { filename: 'scan.PDF', contentType: 'application/octet-stream', content: Buffer.from('x') },
    { filename: 'logo.png', contentType: 'image/png', content: Buffer.from('x') },
  ] };
  assert.deepEqual(routing.pdfAttachments(email).map((a) => a.filename), ['inv.pdf', 'scan.PDF']);
});

test('EMAIL_INVOICE_INTAKE=false turns routing off', () => {
  process.env.EMAIL_INVOICE_INTAKE = 'false';
  assert.equal(routing.enabled(), false);
  delete process.env.EMAIL_INVOICE_INTAKE;
  assert.equal(routing.enabled(), true);
});

test('order extractor exposes and normalizes is_carrier_invoice', () => {
  assert.ok(extractor.EXTRACTION_TOOL.input_schema.properties.is_carrier_invoice);
  assert.equal(extractor.normalizeResult({ is_order_request: false, is_carrier_invoice: 'true', orders: [] }).is_carrier_invoice, true);
});
