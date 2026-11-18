// ═══════════════════════════════════════════════════════════════════
// Mailbox reader — IMAP, read-only.
//
// Connects with an app password, runs a Gmail search (X-GM-RAW) to find
// likely order emails, skips messages already in email_order_intake, and
// returns parsed emails. It never sets flags, moves, or deletes mail:
// dedupe is by Message-ID in the database, so the inbox stays exactly as
// the user left it (unread stays unread).
//
// Config (api/.env):
//   EMAIL_INTAKE_IMAP_HOST   imap.gmail.com
//   EMAIL_INTAKE_IMAP_PORT   993
//   EMAIL_INTAKE_IMAP_USER   sridhar@zoree.io
//   EMAIL_INTAKE_IMAP_PASS   16-char Google app password
//   EMAIL_INTAKE_MAILBOX     INBOX
//   EMAIL_INTAKE_QUERY       Gmail search (see DEFAULT_QUERY)
//
// Optional second account — the common AP mailbox carriers send
// invoices to. Same host/port unless overridden:
//   EMAIL_INTAKE_AP_IMAP_USER   ap@zoree.io
//   EMAIL_INTAKE_AP_IMAP_PASS   16-char Google app password for that account
//   EMAIL_INTAKE_AP_QUERY       Gmail search (see AP_QUERY)
//   EMAIL_INTAKE_AP_AUTO        false = read only when "Read AP Mailbox" is
//                               pressed; anything else = also on the timer
// ═══════════════════════════════════════════════════════════════════

'use strict';

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const domainRouting = require('./domainRouting');
const { parseAuthResults } = require('../invoiceIntake/senderCheck');
const graphMailbox = require('./graphMailbox');

// Recent inbox mail that mentions freight words. Claude then decides
// whether each one is really an order. Narrow it to a label
// (e.g. "label:zoree-orders") once a Gmail filter is in place.
const QUERY_SCOPE = 'in:inbox newer_than:2d -from:me -category:promotions -category:social -category:forums';
const QUERY_WORDS = 'order "purchase order" PO load pickup "pick up" pallet pallets shipment freight BOL tender "ship date" "ready date"';

/**
 * Default search: recent inbox mail that mentions freight words, or that
 * was sent to a client domain's own address (domainRouting) — carrier
 * invoices for that client arrive there whatever their wording.
 */
function defaultQuery() {
  const toDomains = [...domainRouting.addressMap().keys()].map((a) => `to:${a}`).join(' ');
  return `${QUERY_SCOPE} {${QUERY_WORDS}${toDomains ? ` ${toDomains}` : ''}}`;
}
const DEFAULT_QUERY = `${QUERY_SCOPE} {${QUERY_WORDS}}`;
// The AP mailbox only receives invoices: every recent email with a PDF.
const AP_QUERY = 'in:inbox newer_than:7d -from:me has:attachment filename:pdf';
const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;
const SCAN_LIMIT = 100;

function config() {
  return {
    host: process.env.EMAIL_INTAKE_IMAP_HOST || 'imap.gmail.com',
    port: Number(process.env.EMAIL_INTAKE_IMAP_PORT) || 993,
    user: process.env.EMAIL_INTAKE_IMAP_USER || '',
    pass: process.env.EMAIL_INTAKE_IMAP_PASS || '',
    mailbox: process.env.EMAIL_INTAKE_MAILBOX || 'INBOX',
    query: process.env.EMAIL_INTAKE_QUERY || defaultQuery(),
  };
}

/** The common AP mailbox, when one is set up; otherwise null. */
function apConfig() {
  // Microsoft 365 AP mailbox read through Graph (graphMailbox.js).
  if (graphMailbox.isGraph()) {
    const user = graphMailbox.settings().mailbox;
    if (!user) return null;
    return {
      provider: 'graph',
      user,
      mailbox: 'Inbox',
      ap: true,
      auto: String(process.env.EMAIL_INTAKE_AP_AUTO || '').toLowerCase() !== 'false',
    };
  }
  const user = process.env.EMAIL_INTAKE_AP_IMAP_USER || '';
  if (!user) return null;
  const main = config();
  return {
    host: process.env.EMAIL_INTAKE_AP_IMAP_HOST || main.host,
    port: Number(process.env.EMAIL_INTAKE_AP_IMAP_PORT) || main.port,
    user,
    pass: process.env.EMAIL_INTAKE_AP_IMAP_PASS || '',
    mailbox: process.env.EMAIL_INTAKE_AP_MAILBOX || 'INBOX',
    query: process.env.EMAIL_INTAKE_AP_QUERY || AP_QUERY,
    ap: true,
    auto: String(process.env.EMAIL_INTAKE_AP_AUTO || '').toLowerCase() !== 'false',
  };
}

/**
 * The account "Read AP Mailbox" reads: the AP mailbox when one is set up
 * (never a person's mailbox), otherwise the main mailbox.
 */
function invoiceAccount() {
  return apConfig() || config();
}

/**
 * Whether carrier invoices found in `account` are turned into invoices.
 * Once an AP mailbox is set up, only that mailbox creates invoices; the
 * main mailbox keeps reading orders only.
 */
function readsInvoices(account) {
  return Boolean(account && account.ap) || !apConfig();
}

/** Accounts the timer checks: the main mailbox, plus the AP mailbox unless it is button-only. */
function timerAccounts() {
  const ap = apConfig();
  return [config(), ap && ap.auto ? ap : null].filter((a) => isConfigured(a));
}

function isConfigured(account = config()) {
  if (account && account.provider === 'graph') return graphMailbox.isConfigured();
  return Boolean(account && account.user && account.pass);
}

/** Mailbox key stored on intake rows — the account address, lower-cased. */
function mailboxKey(account = config()) {
  return String((account && account.user) || '').toLowerCase();
}

function normalizeMessageId(id) {
  return String(id || '').trim().replace(/^<|>$/g, '');
}

/** One parsed email (mailparser) in the shape the intake pipeline uses. Shared by the IMAP and Graph readers. */
function emailFromParsed(parsed, e) {
  const from = parsed.from && parsed.from.value && parsed.from.value[0] || {};
  return {
    messageId: e.messageId,
    fromAddress: (from.address || '').toLowerCase(),
    fromName: from.name || null,
    // To + Cc — which client domain's address it was sent to (domainRouting).
    toAddresses: [parsed.to, parsed.cc].flat().filter(Boolean)
      .flatMap((h) => (h.value || [])).map((v) => (v.address || '').toLowerCase()).filter(Boolean),
    // SPF / DKIM / DMARC as the receiving server recorded them.
    auth: parseAuthResults(parsed.headers && parsed.headers.get && parsed.headers.get('authentication-results')),
    subject: parsed.subject || '',
    receivedAt: (parsed.date || e.internalDate || new Date()).toISOString(),
    text: parsed.text || '',
    html: typeof parsed.html === 'string' ? parsed.html : '',
    attachments: (parsed.attachments || []).filter((a) => a.contentDisposition !== 'inline' || /pdf/i.test(a.contentType)).map((a) => ({
      filename: a.filename || 'attachment',
      contentType: a.contentType,
      content: a.content,
    })),
  };
}

/**
 * Fetch up to `max` emails matching the query that `isSeen` has not seen.
 * @param {object} opts
 * @param {(ids:string[]) => Promise<Set<string>>} opts.isSeen  returns the subset already processed
 * @param {number} [opts.max=10]
 * @param {object} [opts.account]  which account to read (default: the main mailbox)
 * @returns {Promise<{ scanned:number, emails:object[] }>}
 */
async function fetchNewEmails({ isSeen, max = 10, account = config() }) {
  if (account && account.provider === 'graph') {
    return graphMailbox.fetchNewEmails({ isSeen, max, parse: simpleParser, toEmail: emailFromParsed, normalizeMessageId });
  }
  const c = account;
  if (!c.user || !c.pass) {
    throw new Error(c.ap
      ? `No app password for ${c.user || 'the AP mailbox'}: set EMAIL_INTAKE_AP_IMAP_PASS in api/.env`
      : 'EMAIL_INTAKE_IMAP_USER / EMAIL_INTAKE_IMAP_PASS are not set in api/.env');
  }

  const client = new ImapFlow({
    host: c.host, port: c.port, secure: true,
    auth: { user: c.user, pass: c.pass },
    logger: false,
    socketTimeout: 60000,
  });
  await client.connect();
  const lock = await client.getMailboxLock(c.mailbox, { readOnly: true });
  try {
    const isGmail = client.capabilities && client.capabilities.has('X-GM-EXT-1');
    const criteria = isGmail ? { gmraw: c.query } : { since: new Date(Date.now() - 2 * 86400000) };
    const uids = (await client.search(criteria, { uid: true })) || [];
    const recent = uids.sort((a, b) => b - a).slice(0, SCAN_LIMIT);
    if (!recent.length) return { scanned: 0, emails: [] };

    // Pass 1: envelopes only (cheap) → drop what we've already processed.
    const envs = [];
    for await (const m of client.fetch(recent.join(','), { uid: true, envelope: true, internalDate: true, size: true }, { uid: true })) {
      const messageId = normalizeMessageId(m.envelope && m.envelope.messageId) || `uid-${m.uid}@${c.mailbox}`;
      envs.push({ uid: m.uid, messageId, size: m.size, internalDate: m.internalDate });
    }
    const seen = await isSeen(envs.map((e) => e.messageId));
    const todo = envs.filter((e) => !seen.has(e.messageId) && e.size <= MAX_MESSAGE_BYTES)
      .sort((a, b) => b.uid - a.uid).slice(0, max);

    // Pass 2: full source for the new ones, parsed with mailparser.
    const emails = [];
    for (const e of todo) {
      const msg = await client.fetchOne(String(e.uid), { uid: true, source: true }, { uid: true });
      if (!msg || !msg.source) continue;
      const parsed = await simpleParser(msg.source);
      emails.push(emailFromParsed(parsed, e));
    }
    return { scanned: envs.length, emails };
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
}

module.exports = {
  fetchNewEmails, isConfigured, mailboxKey, config, apConfig, invoiceAccount, timerAccounts, readsInvoices,
  DEFAULT_QUERY, AP_QUERY, normalizeMessageId, emailFromParsed,
};
