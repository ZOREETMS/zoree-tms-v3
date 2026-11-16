// AP inbox run: folder listing, read concurrency helper.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('limited() keeps order and never exceeds the limit', async () => {
  const { limited } = require('../services/invoiceIntake/inboxRun')._internals;
  let active = 0; let peak = 0;
  const task = (v, ms) => async () => { active += 1; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, ms)); active -= 1; return v; };
  const out = await Promise.all(limited([task('a', 20), task('b', 5), task('c', 10), task('d', 1), task('e', 1)], 2));
  assert.deepEqual(out, ['a', 'b', 'c', 'd', 'e']);
  assert.equal(peak, 2);
});

test('limited() passes a failure through to its own slot only', async () => {
  const { limited } = require('../services/invoiceIntake/inboxRun')._internals;
  const ps = limited([async () => 1, async () => { throw new Error('bad read'); }, async () => 3], 2);
  assert.equal(await ps[0], 1);
  await assert.rejects(ps[1], /bad read/);
  assert.equal(await ps[2], 3);
});

test('inbox folder lists PDFs per domain in name order with hashes', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-'));
  process.env.INVOICE_INBOX_DIR = base;
  const inboxFolder = require('../services/invoiceIntake/inboxFolder');
  assert.equal(inboxFolder.list('KESTREL_BAY').exists, false);
  fs.mkdirSync(path.join(base, 'KESTREL_BAY'));
  fs.writeFileSync(path.join(base, 'KESTREL_BAY', '02_b.pdf'), 'two');
  fs.writeFileSync(path.join(base, 'KESTREL_BAY', '01_a.PDF'), 'one');
  fs.writeFileSync(path.join(base, 'KESTREL_BAY', 'notes.txt'), 'x');
  const out = inboxFolder.list('kestrel_bay');
  assert.deepEqual(out.files.map((f) => f.name), ['01_a.PDF', '02_b.pdf']);
  assert.equal(out.files[0].sha256.length, 64);
  assert.notEqual(out.files[0].sha256, out.files[1].sha256);
  assert.throws(() => inboxFolder.list('../etc'), /Invalid domain/);
  delete process.env.INVOICE_INBOX_DIR;
});
