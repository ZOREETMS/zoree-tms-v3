// AP mailbox triggers: new-email watcher (IMAP IDLE), catch-up on
// reconnect, backup-check setting, and one-run-at-a-time queueing.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { EventEmitter } = require('events');

const S = (rel) => path.join(__dirname, '..', 'services', rel);
function stub(rel, exports) { const id = require.resolve(S(rel)); require.cache[id] = { id, filename: id, loaded: true, exports }; }

// ── Poller collaborators (so requestRun can be exercised without IMAP) ──
let reads = 0; let release = []; const waitRead = () => new Promise((r) => release.push(r));
stub('emailIntake/mailbox.js', {
  timerAccounts: () => [{ user: 'orders@x.com' }, { user: 'ap@x.com', ap: true }],
  readsInvoices: () => false,
  mailboxKey: (a) => a.user,
  fetchNewEmails: async () => { reads += 1; await waitRead(); return { scanned: 0, emails: [] }; },
  apConfig: () => null, isConfigured: () => true, config: () => ({ user: 'orders@x.com' }),
});
stub('emailIntake/extractor.js', { isConfigured: () => true });
stub('emailIntake/intakeService.js', { seenMessageIds: async () => new Set() });
stub('emailIntake/domainRouting.js', { resolve: () => 'X', domainsForMailbox: () => [] });
stub('invoiceIntake/intakeRuns.js', { track: async (_o, fn) => fn() });
stub('invoiceIntake/runContext.js', { noteEmailsRead: () => {} });

const poller = require('../services/emailIntake/poller');
const { createWatcher, backupSeconds, watchEnabled } = require('../services/emailIntake/apWatcher');
const { _internals: { scheduleOf } } = (() => { try { return require('../services/invoiceIntake/mailboxRun'); } catch { return { _internals: {} }; } })();

const tick = () => new Promise((r) => setImmediate(r));
async function flushReads() { while (release.length) { release.shift()(); await tick(); await tick(); } }

// ── Fake IMAP client + manual timers ──
function fakeTimers() {
  const q = [];
  return {
    q,
    setTimeout: (fn, ms) => { const t = { fn, ms, done: false }; q.push(t); return t; },
    clearTimeout: (t) => { if (t) t.done = true; },
    async runAll() { while (q.some((t) => !t.done)) { const t = q.find((x) => !x.done); t.done = true; await t.fn(); await tick(); } },
    pendingMs() { return q.filter((t) => !t.done).map((t) => t.ms); },
  };
}
function fakeClientFactory({ failFirst = 0 } = {}) {
  const made = [];
  let failures = failFirst;
  const make = () => {
    const c = new EventEmitter();
    c.connect = async () => { if (failures > 0) { failures -= 1; throw new Error('connect refused'); } };
    c.mailboxOpen = async () => ({});
    c.close = () => { c.emit('close'); };
    c.logout = async () => {};
    made.push(c);
    return c;
  };
  return { make, made };
}

test('watcher: a catch-up check runs as soon as it connects', async () => {
  const timers = fakeTimers(); const calls = []; const f = fakeClientFactory();
  const w = createWatcher({ account: { mailbox: 'INBOX' }, onNewMail: (r) => calls.push(r), makeClient: f.make, timers });
  await w.start();
  assert.equal(w.status().connected, true);
  await timers.runAll();
  assert.deepEqual(calls, ['catch-up']);
  w.stop();
});

test('watcher: new mail triggers one run; a burst of notifications is one run', async () => {
  const timers = fakeTimers(); const calls = []; const f = fakeClientFactory();
  const w = createWatcher({ account: {}, onNewMail: (r) => calls.push(r), makeClient: f.make, timers });
  await w.start(); await timers.runAll(); calls.length = 0;
  f.made[0].emit('exists', { count: 5, prevCount: 4 });
  f.made[0].emit('exists', { count: 6, prevCount: 5 });
  await timers.runAll();
  assert.deepEqual(calls, ['new-email']);
  assert.ok(w.status().lastEventAt);
  w.stop();
});

test('watcher: a message count that did not grow (a delete) does not start a run', async () => {
  const timers = fakeTimers(); const calls = []; const f = fakeClientFactory();
  const w = createWatcher({ account: {}, onNewMail: (r) => calls.push(r), makeClient: f.make, timers });
  await w.start(); await timers.runAll(); calls.length = 0;
  f.made[0].emit('exists', { count: 4, prevCount: 5 });
  await timers.runAll();
  assert.deepEqual(calls, []);
  w.stop();
});

test('watcher: a dropped connection reconnects and catches up on mail it missed', async () => {
  const timers = fakeTimers(); const calls = []; const f = fakeClientFactory();
  const w = createWatcher({ account: {}, onNewMail: (r) => calls.push(r), makeClient: f.make, timers });
  await w.start(); await timers.runAll(); calls.length = 0;
  f.made[0].emit('close');
  assert.equal(w.status().connected, false);
  await timers.runAll();
  assert.equal(f.made.length, 2, 'a new connection was opened');
  assert.equal(w.status().connected, true);
  assert.deepEqual(calls, ['catch-up']);
  w.stop();
});

test('watcher: failed connects back off 5s, 10s, 20s… and reset after success', async () => {
  const timers = fakeTimers(); const f = fakeClientFactory({ failFirst: 3 });
  const w = createWatcher({ account: {}, onNewMail: () => {}, makeClient: f.make, timers });
  await w.start();
  await timers.runAll();
  const waits = timers.q.map((t) => t.ms).filter((ms) => ms !== 2000); // 2000 = the catch-up debounce
  assert.deepEqual(waits, [5000, 10000, 20000]);
  assert.equal(w.status().connected, true);
  assert.equal(w.status().reconnects, 3);
  f.made[f.made.length - 1].emit('close'); // after a success the wait starts at 5s again
  assert.deepEqual(timers.pendingMs(), [5000]);
  w.stop();
});

test('watcher: stop() closes it and nothing reconnects', async () => {
  const timers = fakeTimers(); const f = fakeClientFactory();
  const w = createWatcher({ account: {}, onNewMail: () => {}, makeClient: f.make, timers });
  await w.start(); await timers.runAll();
  w.stop();
  f.made[0].emit('close');
  await timers.runAll();
  assert.equal(f.made.length, 1);
});

test('settings: backup check defaults to 5 minutes, can be turned off, minimum 60s', () => {
  assert.equal(backupSeconds({}), 300);
  assert.equal(backupSeconds({ EMAIL_INTAKE_AP_BACKUP_SECONDS: 'off' }), 0);
  assert.equal(backupSeconds({ EMAIL_INTAKE_AP_BACKUP_SECONDS: '0' }), 0);
  assert.equal(backupSeconds({ EMAIL_INTAKE_AP_BACKUP_SECONDS: '900' }), 900);
  assert.equal(backupSeconds({ EMAIL_INTAKE_AP_BACKUP_SECONDS: '10' }), 60);
  assert.equal(watchEnabled({}), true);
  assert.equal(watchEnabled({ EMAIL_INTAKE_AP_WATCH: 'off' }), false);
});

test('poller: a trigger during a run queues exactly one more run (no email waits for the backup check)', async () => {
  reads = 0; release = [];
  const first = poller.requestRun({ accounts: [{ user: 'ap@x.com' }], trigger: 'schedule', startedBy: 'new-email' });
  await tick();
  assert.equal(reads, 1);
  const q1 = await poller.requestRun({ accounts: [{ user: 'ap@x.com' }], trigger: 'schedule', startedBy: 'new-email' });
  const q2 = await poller.requestRun({ accounts: [{ user: 'ap@x.com' }], trigger: 'schedule', startedBy: 'backup-check' });
  assert.deepEqual(q1, { queued: true });
  assert.deepEqual(q2, { queued: true });
  await flushReads(); await first;
  await flushReads();
  assert.equal(reads, 2, 'two queued triggers → one extra run, not two');
  assert.equal(poller.status().running, false);
});

test('poller: once the AP watcher owns the AP mailbox, the general timer skips it', async () => {
  reads = 0; release = [];
  const seen = [];
  const mb = require.cache[require.resolve(S('emailIntake/mailbox.js'))].exports;
  const orig = mb.fetchNewEmails;
  mb.fetchNewEmails = async ({ account }) => { seen.push(account.user); return { scanned: 0, emails: [] }; };
  poller.setApHandled(true);
  await poller.runOnce();
  poller.setApHandled(false);
  await poller.runOnce();
  mb.fetchNewEmails = orig;
  assert.deepEqual(seen, ['orders@x.com', 'orders@x.com', 'ap@x.com']);
});

test('runs tab: live mode reports the new-email trigger and the backup interval', { skip: !scheduleOf }, () => {
  const s = scheduleOf({ enabled: true, lastRunAt: '2026-11-17T19:00:00Z', intervalSec: 120 }, { user: 'ap@x.com', auto: true },
    { active: true, watching: true, connected: true, backupSec: 300, lastEventAt: null, mailbox: 'ap@x.com' });
  assert.equal(s.live, true);
  assert.equal(s.everySec, 300);
  assert.equal(s.connected, true);
  const off = scheduleOf({ enabled: true, lastRunAt: null, intervalSec: 120 }, { user: 'ap@x.com', auto: false }, { active: false });
  assert.equal(off.on, false);
});
