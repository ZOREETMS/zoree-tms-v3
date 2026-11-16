// Sender verification: pure rules.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verify, parseAuthResults } = require('../services/invoiceIntake/senderCheck');

const carrier = { name: 'RIDGELINE FREIGHT', contact_email: 'billing@ridgeline.com', email: 'ar@ridgeline-factor.com' };
const env = {};

test('any address on a domain on file is verified (domain, not person)', () => {
  assert.equal(verify({ sender: 'jane@ridgeline.com', carrierRow: carrier, source: 'email', env }).status, 'verified');
  assert.equal(verify({ sender: 'x@ridgeline-factor.com', carrierRow: carrier, source: 'email', env }).status, 'verified');
});

test('a different domain or failed authentication is unverified', () => {
  assert.equal(verify({ sender: 'billing@ridge1ine.com', carrierRow: carrier, source: 'email', env }).status, 'unverified');
  assert.equal(verify({ sender: 'billing@ridgeline.com', auth: { dmarc: 'fail' }, carrierRow: carrier, source: 'email', env }).status, 'unverified');
  assert.equal(verify({ sender: 'billing@ridgeline.com', auth: { spf: 'softfail' }, carrierRow: carrier, source: 'email', env }).status, 'unverified');
});

test('no billing email on file is unregistered; uploads and the off switch are not checked', () => {
  assert.equal(verify({ sender: 'a@b.com', carrierRow: { name: 'X' }, source: 'email', env }).status, 'unregistered');
  assert.equal(verify({ sender: 'a@b.com', carrierRow: carrier, source: 'pdf_upload', env }).status, 'not_checked');
  assert.equal(verify({ sender: 'a@b.com', carrierRow: carrier, source: 'email', env: { EMAIL_INVOICE_SENDER_CHECK: 'off' } }).status, 'not_checked');
});

test('Authentication-Results header is parsed', () => {
  assert.deepEqual(parseAuthResults('mx.google.com; dkim=pass header.i=@zoree.io; spf=pass smtp.mailfrom=x; dmarc=pass (p=NONE)'), { spf: 'pass', dkim: 'pass', dmarc: 'pass' });
  assert.deepEqual(parseAuthResults(null), {});
});
