// ═══════════════════════════════════════════════════════════════════
// Email intake poller — checks the mailbox on an interval.
//
// Off unless EMAIL_INTAKE_ENABLED=true. One run at a time: the interval
// tick and the "Check inbox now" button share the same in-flight guard,
// so the same email can never be extracted twice concurrently.
//
//   EMAIL_INTAKE_ENABLED        true | false (default false)
//   EMAIL_INTAKE_POLL_SECONDS   default 120 (min 30)
//   EMAIL_INTAKE_MAX_PER_POLL   default 10 emails sent to Claude per run
// ═══════════════════════════════════════════════════════════════════

'use strict';

const mailbox = require('./mailbox');
const extractor = require('./extractor');
const intake = require('./intakeService');
const domainRouting = require('./domainRouting');
const { runInDomain } = require('../domains/domainContext');
const intakeRuns = require('../invoiceIntake/intakeRuns');
const runContext = require('../invoiceIntake/runContext');

const READ_CONCURRENCY = 4;

/** Run tasks with at most `limit` in flight; one promise per task, in order. */
function limited(tasks, limit) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= limit || !queue.length) return;
    active += 1;
    const { task, resolve, reject } = queue.shift();
    task().then(resolve, reject).finally(() => { active -= 1; next(); });
  };
  return tasks.map((task) => new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); next(); }));
}

const state = {
  enabled: false,
  running: false,
  timer: null,
  intervalSec: null,
  lastRunAt: null,
  lastResult: null,
  lastError: null,
};

/** Read one account's new emails and process them, adding to `tally`. */
async function readAccount(account, tally) {
  const box = mailbox.mailboxKey(account);
  const max = Math.max(1, Number(process.env.EMAIL_INTAKE_MAX_PER_POLL) || 10);
  const { scanned, emails } = await mailbox.fetchNewEmails({
    isSeen: (ids) => intake.seenMessageIds(box, ids),
    max,
    account,
  });
  tally.scanned += scanned;
  runContext.noteEmailsRead(emails.length);
  const invoices = mailbox.readsInvoices(account);
  // Oldest first: a resent invoice must be seen after the original.
  emails.sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)));
  // Each email is handled in the client domain it was addressed to.
  const domains = emails.map((email) => domainRouting.resolve(email));
  // Claude reads several emails at once; the decisions below stay in order.
  const pres = limited(emails.map((email, i) => () => runInDomain(domains[i], () => intake.preprocessEmail(email, { invoices, invoiceOnly: Boolean(account.ap) }))), READ_CONCURRENCY);
  pres.forEach((p) => p.catch(() => {})); // a failed read is recorded by processEmail
  for (let i = 0; i < emails.length; i += 1) {
    const row = await runInDomain(domains[i], () => intake.processEmail(emails[i], { source: 'imap', mailbox: box, pre: pres[i], invoices })); // eslint-disable-line no-await-in-loop
    if (!row) continue;
    tally.processed++;
    tally[row.status] = (tally[row.status] || 0) + 1;
  }
}

/**
 * Read one account as a logged agent run (migration 056) when it can create
 * invoices; the orders-only mailbox is read without a run.
 */
function readAccountLogged(account, tally, { trigger, startedBy, domains }) {
  if (!mailbox.readsInvoices(account)) return readAccount(account, tally);
  return intakeRuns.track({
    trigger, channel: 'ap_mailbox', startedBy, mailbox: mailbox.mailboxKey(account),
    domains, failureDomains: domains.length ? domains : domainRouting.domainsForMailbox(account.user),
  }, () => readAccount(account, tally));
}

/**
 * Check mailboxes now. One run at a time.
 * @param {{ accounts?: object[], trigger?: 'schedule'|'manual', startedBy?: string, domains?: string[] }} [opts]
 *   accounts   to read (default: what the timer reads)
 *   trigger    'schedule' for the timer, 'manual' for "Read AP Mailbox"
 *   startedBy  who pressed the button ('scheduler' for the timer)
 *   domains    domains that get a run row even if nothing new arrives (the button's domain)
 */
async function runOnce({ accounts = null, trigger = 'schedule', startedBy = 'scheduler', domains = [] } = {}) {
  if (state.running) return { skipped: true, reason: 'a check is already running' };
  const list = accounts || mailbox.timerAccounts();
  if (!list.length) throw new Error('Mailbox not configured: set EMAIL_INTAKE_IMAP_USER and EMAIL_INTAKE_IMAP_PASS in api/.env');
  if (!extractor.isConfigured()) throw new Error('ANTHROPIC_API_KEY is not set in api/.env');
  state.running = true;
  const started = Date.now();
  try {
    const tally = { scanned: 0, processed: 0, pending_review: 0, created: 0, not_order: 0, error: 0 };
    const failures = [];
    // One mailbox failing (e.g. a wrong app password) must not stop the other.
    for (const account of list) {
      try { await readAccountLogged(account, tally, { trigger, startedBy, domains }); } // eslint-disable-line no-await-in-loop
      catch (err) { failures.push(`${account.user || 'mailbox'}: ${err.message}`); }
    }
    if (failures.length === list.length) throw new Error(failures.join(' · '));
    state.lastResult = { ...tally, ms: Date.now() - started };
    state.lastError = failures.length ? failures.join(' · ') : null;
    if (tally.processed) console.log('[emailIntake] poll:', JSON.stringify(state.lastResult));
    return state.lastResult;
  } catch (err) {
    state.lastError = err.message;
    console.error('[emailIntake] poll failed:', err.message);
    throw err;
  } finally {
    state.running = false;
    state.lastRunAt = new Date().toISOString();
  }
}

function start() {
  if (String(process.env.EMAIL_INTAKE_ENABLED || '').toLowerCase() !== 'true') {
    console.log('   ℹ️  Email order agent off (EMAIL_INTAKE_ENABLED is not true)');
    return false;
  }
  if (!mailbox.timerAccounts().length || !extractor.isConfigured()) {
    console.log('   ⚠️  Email order agent enabled but missing EMAIL_INTAKE_IMAP_USER/PASS or ANTHROPIC_API_KEY — not started');
    return false;
  }
  const sec = Math.max(30, Number(process.env.EMAIL_INTAKE_POLL_SECONDS) || 120);
  state.enabled = true;
  state.intervalSec = sec;
  state.timer = setInterval(() => { runOnce().catch(() => {}); }, sec * 1000);
  if (state.timer.unref) state.timer.unref();
  setTimeout(() => { runOnce().catch(() => {}); }, 5000);
  console.log(`   ✅ Email order agent watching ${mailbox.timerAccounts().map((a) => a.user).join(' + ')} every ${sec}s`);
  const ap = mailbox.apConfig();
  if (ap && !ap.auto) console.log(`   ℹ️  AP mailbox ${ap.user} is read only when "Read AP Mailbox" is pressed`);
  return true;
}

function stop() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.enabled = false;
}

function status() {
  const c = mailbox.config();
  return {
    enabled: state.enabled,
    running: state.running,
    intervalSec: state.intervalSec,
    mailbox: c.user || null,
    query: c.query,
    mailboxConfigured: mailbox.isConfigured(),
    apMailbox: (mailbox.apConfig() || {}).user || null,
    apMailboxConfigured: mailbox.isConfigured(mailbox.apConfig()),
    claudeConfigured: extractor.isConfigured(),
    model: process.env.EMAIL_INTAKE_MODEL || extractor.DEFAULT_MODEL,
    autoCreate: String(process.env.EMAIL_INTAKE_AUTO_CREATE || '').toLowerCase() === 'true',
    lastRunAt: state.lastRunAt,
    lastResult: state.lastResult,
    lastError: state.lastError,
  };
}

module.exports = { start, stop, runOnce, status };
