// ═══════════════════════════════════════════════════════════════════
// AP mailbox run — "Read AP Mailbox" on Freight Invoices.
//
// Starts a mailbox check (the same one the email agent runs on its
// timer) and reports the carrier invoices it read for the current
// domain. Results come from invoice_intakes, so they are the same
// whether the button or the timer picked the email up.
//
// The mailbox is a common AP mailbox, not a person's: carriers send
// invoices to one address per client, and anyone with the finance role
// in that client's domain can run the check and see the results. It is
// the account in EMAIL_INTAKE_AP_IMAP_USER when set, else the main one.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const db = require('../supabase');
const repo = require('./intakeRepository');
const poller = require('../emailIntake/poller');
const mailbox = require('../emailIntake/mailbox');
const domainRouting = require('../emailIntake/domainRouting');
const { currentDomain } = require('../domains/domainContext');
const intakeLog = require('./intakeLog');
const intakeRuns = require('./intakeRuns');

function result(row, invoice) {
  return {
    intakeId: row.id, fileName: row.file_name, status: row.status,
    invoiceId: row.invoice_id || null, invoiceNumber: row.invoice_number, carrier: row.carrier,
    shipmentRef: row.shipment_ref, total: row.total, confidence: row.read_confidence,
    problems: row.problems || [], summary: row.outcome_reason,
    // Same outcome the Invoice audit list shows (one rule, in intakeLog).
    outcome: intakeLog.outcomeOf(row, invoice),
    invoiceStatus: invoice ? invoice.status : null, sentToAp: Boolean(invoice && invoice.sent_to_ap_at),
  };
}

/** Mailbox state + the invoices read from email since `since` (ISO), for the current domain. */
async function status({ since } = {}) {
  const from = since && !Number.isNaN(Date.parse(since)) ? new Date(since).toISOString() : new Date(Date.now() - 10 * 60000).toISOString();
  const rows = await repo.listEmailSince(from);
  const ids = [...new Set(rows.map((r) => r.invoice_id).filter(Boolean))];
  const invoices = ids.length ? await db.dbSelect('invoices', { select: 'id,status,sent_to_ap_at', filters: [['id', 'in', ids]], limit: ids.length }) : [];
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const p = poller.status();
  const domain = currentDomain();
  const account = mailbox.invoiceAccount();
  return {
    domain,
    mailbox: mailbox.mailboxKey(account) || null,
    configured: mailbox.isConfigured(account) && p.claudeConfigured,
    address: domainRouting.addressFor(domain, undefined, account.user),
    running: p.running, lastRunAt: p.lastRunAt, lastError: p.lastError, lastResult: p.lastResult,
    since: from,
    results: rows.map((r) => result(r, byId.get(r.invoice_id))),
  };
}

/** Start a mailbox check now (no-op when one is already running). Logged as a manual run by `user`. */
function start({ user = null } = {}) {
  const p = poller.status();
  const account = mailbox.invoiceAccount();
  if (!mailbox.isConfigured(account)) {
    const e = new Error(account.ap
      ? `The AP mailbox ${account.user} is not connected yet. Add its Google app password to api/.env (EMAIL_INTAKE_AP_IMAP_PASS) and restart the servers.`
      : 'Mailbox not configured: set EMAIL_INTAKE_IMAP_USER and EMAIL_INTAKE_IMAP_PASS in api/.env');
    e.status = 400; throw e;
  }
  // startedAt (server clock) lets the caller show only what THIS check read.
  const startedAt = new Date().toISOString();
  if (p.running) return { started: false, running: true, startedAt };
  poller.runOnce({ accounts: [account], trigger: 'manual', startedBy: (user && user.email) || 'unknown', domains: [currentDomain()] })
    .catch(() => {}); // the error is kept in poller.status().lastError and on the run row
  return { started: true, running: true, startedAt };
}

/** Pure: whether the timer reads the AP mailbox, and how often. */
function scheduleOf(pollerStatus, ap) {
  const on = Boolean(pollerStatus.enabled && ap && ap.auto);
  return {
    on,
    everySec: on ? pollerStatus.intervalSec : null,
    lastCheckAt: on ? pollerStatus.lastRunAt : null,
    mailbox: ap ? ap.user : null,
  };
}

/** Agent run log for the current domain: every scheduled check that read something, every button press. */
async function runLog({ limit = 50 } = {}) {
  const runs = await intakeRuns.listRuns({ limit });
  return { runs, schedule: scheduleOf(poller.status(), mailbox.apConfig()) };
}

module.exports = { status, start, runLog, runDetail: intakeRuns.runDetail, _internals: { scheduleOf } };
