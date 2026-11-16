// Which mailboxes the timer and the "Read AP Mailbox" button read.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mailbox = require('../services/emailIntake/mailbox');

const KEYS = ['EMAIL_INTAKE_IMAP_USER', 'EMAIL_INTAKE_IMAP_PASS', 'EMAIL_INTAKE_AP_IMAP_USER', 'EMAIL_INTAKE_AP_IMAP_PASS', 'EMAIL_INTAKE_AP_AUTO', 'EMAIL_INTAKE_AP_QUERY'];
function withEnv(values, fn) {
  const before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  KEYS.forEach((k) => { delete process.env[k]; });
  Object.assign(process.env, values);
  try { return fn(); } finally {
    KEYS.forEach((k) => { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; });
  }
}
const MAIN = { EMAIL_INTAKE_IMAP_USER: 'orders@x.com', EMAIL_INTAKE_IMAP_PASS: 'p1' };

test('without an AP mailbox, the button and the timer read the main mailbox', () => withEnv(MAIN, () => {
  assert.equal(mailbox.apConfig(), null);
  assert.equal(mailbox.invoiceAccount().user, 'orders@x.com');
  assert.deepEqual(mailbox.timerAccounts().map((a) => a.user), ['orders@x.com']);
}));

test('with an AP mailbox, the button reads it and the timer reads both', () => withEnv({ ...MAIN, EMAIL_INTAKE_AP_IMAP_USER: 'AP@x.com', EMAIL_INTAKE_AP_IMAP_PASS: 'p2' }, () => {
  const ap = mailbox.invoiceAccount();
  assert.equal(ap.user, 'AP@x.com');
  assert.equal(mailbox.mailboxKey(ap), 'ap@x.com');
  assert.equal(ap.query, mailbox.AP_QUERY);
  assert.equal(mailbox.isConfigured(ap), true);
  assert.deepEqual(mailbox.timerAccounts().map((a) => a.user), ['orders@x.com', 'AP@x.com']);
}));

test('EMAIL_INTAKE_AP_AUTO=false keeps the AP mailbox off the timer', () => withEnv({ ...MAIN, EMAIL_INTAKE_AP_IMAP_USER: 'ap@x.com', EMAIL_INTAKE_AP_IMAP_PASS: 'p2', EMAIL_INTAKE_AP_AUTO: 'false' }, () => {
  assert.deepEqual(mailbox.timerAccounts().map((a) => a.user), ['orders@x.com']);
  assert.equal(mailbox.invoiceAccount().user, 'ap@x.com');
}));

test('an AP mailbox without its app password: the button still reads only the AP mailbox, and says what is missing', async () => {
  await withEnv({ ...MAIN, EMAIL_INTAKE_AP_IMAP_USER: 'ap@x.com' }, async () => {
    const ap = mailbox.invoiceAccount();
    assert.equal(ap.user, 'ap@x.com');
    assert.equal(mailbox.isConfigured(ap), false);
    assert.deepEqual(mailbox.timerAccounts().map((a) => a.user), ['orders@x.com']);
    await assert.rejects(() => mailbox.fetchNewEmails({ isSeen: async () => new Set(), account: ap }), /EMAIL_INTAKE_AP_IMAP_PASS/);
  });
});

test('once an AP mailbox is set up, only it creates invoices; the main mailbox reads orders only', () => {
  withEnv({ ...MAIN, EMAIL_INTAKE_AP_IMAP_USER: 'ap@x.com', EMAIL_INTAKE_AP_IMAP_PASS: 'p2' }, () => {
    assert.equal(mailbox.readsInvoices(mailbox.config()), false);
    assert.equal(mailbox.readsInvoices(mailbox.apConfig()), true);
  });
  withEnv(MAIN, () => assert.equal(mailbox.readsInvoices(mailbox.config()), true));
});
