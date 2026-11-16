// ═══════════════════════════════════════════════════════════════════
// Email order intake — orchestration.
//
//   processEmail(email)     extract with Claude → validate → store draft
//                           (or auto-create when policy allows)
//   approveIntake(id, …)    planner approves (optionally edited) drafts
//                           → orders created via services/orderCreate
//   rejectIntake(id, …)     planner rejects; nothing is written to orders
//   retryIntake(id)         re-run extraction on a stored email body
//
// Table: email_order_intake (migration 049). Status is controlled:
//   pending_review | created | rejected | not_order | error
// ═══════════════════════════════════════════════════════════════════

'use strict';

const crypto = require('crypto');

const extractor = require('./extractor');
const mapper = require('./draftMapper');
const repo = require('./intakeRepository');
const { createOrder, rollbackCreatedOrder } = require('../orderCreate');
const invoiceRouting = require('./invoiceRouting');

const { clean, streetLine, draftToOrderBody, draftLines, rowMissing, hasRequiredGaps, REQUIRED } = mapper;
const { knownCustomers, duplicatePOs, insertRow, updateRow, getIntake } = repo;
const AGENT_USER = { email: 'email-intake-agent', role: 'system' };

function envBool(name, dflt = false) {
  const v = process.env[name];
  if (v === undefined || v === '') return dflt;
  return String(v).toLowerCase() === 'true';
}

// ── Core ───────────────────────────────────────────────────────────

/**
 * Extract + store one email. Returns the stored intake row.
 * @param {object} email { messageId, fromAddress, fromName, subject, receivedAt, text, html, attachments }
 * @param {object} meta  { source: 'imap'|'paste', mailbox, pre?: Promise from preprocessEmail }
 */
/**
 * The slow, independent part of processEmail: Claude classifies the email
 * and, for a carrier invoice, starts reading its PDFs. The mailbox run does
 * this for several emails at once, then calls processEmail in arrival order.
 */
async function preprocessEmail(email, { invoices = true, invoiceOnly = false } = {}) {
  // The AP mailbox only receives carrier invoices: skip the "is this an
  // order?" model call and go straight to reading the PDFs (about half the time).
  if (invoiceOnly && invoices && invoiceRouting.enabled()) {
    const ext = { result: { is_order_request: false, is_carrier_invoice: true, is_order_confidence: 0, reason: 'AP mailbox: PDFs are read as carrier invoices.' }, model: null, usage: {}, skippedAttachments: [] };
    return { ext, invoiceReads: invoiceRouting.startReads(email) };
  }
  const ext = await extractor.extractOrderFromEmail(email, { knownCustomers: await knownCustomers() });
  const r = ext.result || {};
  const isInvoice = invoices && !r.is_order_request && r.is_carrier_invoice && invoiceRouting.enabled();
  return { ext, invoiceReads: isInvoice ? invoiceRouting.startReads(email) : null };
}

async function processEmail(email, { source = 'imap', mailbox, pre = null, invoices = true }) {
  const base = {
    source,
    mailbox,
    message_id: email.messageId,
    from_address: email.fromAddress || null,
    from_name: email.fromName || null,
    subject: email.subject || null,
    received_at: email.receivedAt || new Date().toISOString(),
    attachment_names: (email.attachments || []).map((a) => a.filename || 'attachment'),
  };
  const bodyText = (email.text && email.text.trim()) ? email.text : extractor.htmlToText(email.html);

  let ext;
  let invoiceReads = null;
  try {
    if (pre) ({ ext, invoiceReads } = await pre);
    else ext = await extractor.extractOrderFromEmail(email, { knownCustomers: await knownCustomers() });
  } catch (err) {
    console.error('[emailIntake] extraction failed:', err.message);
    return insertRow({ ...base, status: 'error', error: err.message.slice(0, 1000), body_text: bodyText });
  }

  const r = ext.result || {};
  const confidence = Math.max(0, Math.min(1, Number(r.is_order_confidence) || 0));
  const usage = { model: ext.model, input_tokens: ext.usage.input_tokens || null, output_tokens: ext.usage.output_tokens || null };
  const drafts = Array.isArray(r.orders) ? r.orders : [];

  if (r.is_order_request && !drafts.length) {
    // Claude said "order" twice but gave no usable draft. Keep the body and
    // surface it under Errors (with Re-run AI) rather than hide a real order.
    return insertRow({ ...base, ...usage, status: 'error', is_order_confidence: confidence, body_text: bodyText,
      extracted: { reason: r.reason || null },
      error: 'The AI marked this as an order but returned no order details. Click "Re-run AI" or paste it again.' });
  }
  if (!r.is_order_request && r.is_carrier_invoice && !invoices) {
    // Carrier invoices are read only from the AP mailbox, not this one.
    return insertRow({ ...base, ...usage, status: 'not_order', is_order_confidence: confidence,
      extracted: { reason: r.reason || null, carrier_invoice: true, skipped: 'Carrier invoices are read from the AP mailbox only.' } });
  }
  if (!r.is_order_request && r.is_carrier_invoice && invoiceRouting.enabled() && invoiceRouting.pdfAttachments(email).length) {
    // Carrier invoice: each PDF goes through invoice intake (migration 051).
    // The email row stays 'not_order' and points at what was created.
    const invoices = await invoiceRouting.routeInvoiceEmail(email, { preReads: invoiceReads });
    return insertRow({ ...base, ...usage, status: 'not_order', is_order_confidence: confidence,
      extracted: { reason: r.reason || null, carrier_invoice: true, invoice_intakes: invoices } });
  }
  if (!r.is_order_request) {
    // Keep sender + subject only; no body for non-order mail.
    return insertRow({ ...base, ...usage, status: 'not_order', is_order_confidence: confidence, extracted: { reason: r.reason || null } });
  }

  const missing = rowMissing(drafts);
  const duplicates = await duplicatePOs(drafts).catch(() => []);
  const extracted = {
    reason: r.reason || null,
    questions_for_sender: r.questions_for_sender || [],
    skipped_attachments: ext.skippedAttachments,
    duplicates,
    drafts,
  };
  const row = await insertRow({
    ...base, ...usage,
    status: 'pending_review',
    is_order_confidence: confidence,
    extracted,
    missing_fields: missing,
    body_text: bodyText,
  });
  if (!row) return null;

  const minConf = Number(process.env.EMAIL_INTAKE_AUTO_CREATE_MIN_CONFIDENCE) || 0.9;
  if (envBool('EMAIL_INTAKE_AUTO_CREATE') && confidence >= minConf && !hasRequiredGaps(missing) && !duplicates.length) {
    try {
      return (await approveIntake(row.id, {}, AGENT_USER)).intake;
    } catch (err) {
      console.error('[emailIntake] auto-create failed, left for review:', err.message);
    }
  }
  return row;
}

/**
 * Approve: create one order per draft. `edits.drafts` (optional) replaces
 * the stored drafts with the reviewer's corrected version.
 */
/** "Jane Doe <jane@x.com>" → { fromAddress, fromName }. */
function parseSender(from) {
  const raw = String(from || '');
  const m = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return {
    fromAddress: (m ? m[2] : raw).trim().toLowerCase() || null,
    fromName: m ? (m[1].replace(/^"|"$/g, '') || null) : null,
  };
}

/**
 * Run the agent on an email a planner pasted into the UI.
 * @param {{from?:string, subject?:string, body:string}} input
 * @param {object} user  signed-in user (mailbox is tagged with them)
 */
async function processPastedEmail({ from = '', subject = '', body = '' } = {}, user = {}) {
  if (!String(body).trim()) { const e = new Error('body is required'); e.status = 400; throw e; }
  return processEmail({
    messageId: `paste-${crypto.randomUUID()}`,
    ...parseSender(from),
    subject: String(subject),
    receivedAt: new Date().toISOString(),
    text: String(body),
    attachments: [],
  }, { source: 'paste', mailbox: `paste:${user.email || user.id || 'user'}` });
}

async function approveIntake(id, edits = {}, user) {
  const intake = await getIntake(id);
  if (!intake) { const e = new Error('Intake not found'); e.status = 404; throw e; }
  if (intake.status !== 'pending_review') {
    const e = new Error(`Intake is '${intake.status}', only pending_review can be approved`); e.status = 409; throw e;
  }
  const drafts = Array.isArray(edits.drafts) && edits.drafts.length ? edits.drafts : (intake.extracted && intake.extracted.drafts) || [];
  if (!drafts.length) { const e = new Error('No order drafts to create'); e.status = 400; throw e; }

  const missing = rowMissing(drafts);
  if (hasRequiredGaps(missing)) {
    const e = new Error(`Fill in required fields first: ${missing.filter((m) => REQUIRED.includes(m.split('.').pop())).join(', ')}`);
    e.status = 400; e.missing = missing; throw e;
  }

  // Claim the row so a double-click / second reviewer can't create twice.
  const claimed = await updateRow(id, { status: 'created', reviewed_by: user && (user.email || user.id) || 'unknown', reviewed_at: new Date().toISOString() }, 'pending_review');
  if (!claimed) { const e = new Error('Intake was already handled by someone else'); e.status = 409; throw e; }

  const ctx = { subject: intake.subject, fromAddress: intake.from_address };
  const created = [];
  try {
    for (const d of drafts) {
      const body = draftToOrderBody(d, ctx);
      const shipToAddress = d.ship_to && clean(d.ship_to.street) ? streetLine(d.ship_to) : null;
      const order = await createOrder({
        body,
        lines: draftLines(d),
        user,
        syncSource: 'email',
        extra: { email_intake_id: id, ...(shipToAddress ? { ship_to_address: shipToAddress } : {}) },
      });
      created.push(order.id);
    }
  } catch (err) {
    for (const oid of created) await rollbackCreatedOrder(oid, user).catch(() => {});
    await updateRow(id, { status: 'pending_review', reviewed_by: null, reviewed_at: null, error: `Approve failed: ${err.message}`.slice(0, 1000) });
    throw err;
  }

  const final = await updateRow(id, {
    extracted: { ...(intake.extracted || {}), approved_drafts: drafts, edited: Array.isArray(edits.drafts), order_ids: created },
    missing_fields: missing,
    error: null,
  });
  return { intake: final, orderIds: created };
}

async function rejectIntake(id, reason, user) {
  const row = await updateRow(id, {
    status: 'rejected',
    reviewed_by: user && (user.email || user.id) || 'unknown',
    reviewed_at: new Date().toISOString(),
    error: reason ? `Rejected: ${String(reason).slice(0, 500)}` : null,
  }, ['pending_review', 'error', 'not_order']);
  if (!row) { const e = new Error('Only pending, error or not-an-order items can be rejected'); e.status = 409; throw e; }
  return row;
}

/** Re-run extraction on the stored body (error rows, or a not_order the planner says is an order). */
async function retryIntake(id) {
  const intake = await getIntake(id);
  if (!intake) { const e = new Error('Intake not found'); e.status = 404; throw e; }
  if (!['error', 'not_order', 'rejected'].includes(intake.status)) {
    const e = new Error(`Intake is '${intake.status}' — nothing to retry`); e.status = 409; throw e;
  }
  if (!intake.body_text) { const e = new Error('Email body was not stored for this item; re-send or paste it'); e.status = 400; throw e; }
  const email = { fromAddress: intake.from_address, fromName: intake.from_name, subject: intake.subject, receivedAt: intake.received_at, text: intake.body_text, attachments: [] };
  const ext = await extractor.extractOrderFromEmail(email, { knownCustomers: await knownCustomers() });
  const r = ext.result || {};
  const drafts = Array.isArray(r.orders) ? r.orders : [];
  const missing = rowMissing(drafts);
  const duplicates = await duplicatePOs(drafts).catch(() => []);
  if (r.is_order_request && !drafts.length) {
    const e = new Error('The AI marked this as an order but returned no order details again — paste it in with any missing details.'); e.status = 502; throw e;
  }
  return updateRow(id, {
    status: drafts.length ? 'pending_review' : 'not_order',
    is_order_confidence: Math.max(0, Math.min(1, Number(r.is_order_confidence) || 0)),
    extracted: { reason: r.reason || null, questions_for_sender: r.questions_for_sender || [], duplicates, drafts, retried: true },
    missing_fields: missing,
    error: null,
    model: ext.model,
    input_tokens: ext.usage.input_tokens || null,
    output_tokens: ext.usage.output_tokens || null,
  });
}

module.exports = {
  processEmail, preprocessEmail, processPastedEmail, approveIntake, rejectIntake, retryIntake, parseSender,
  // Read-side passthroughs so routes/poller keep one import.
  getIntake: repo.getIntake, listIntake: repo.listIntake, statusCounts: repo.statusCounts, seenMessageIds: repo.seenMessageIds,
  // Pure mapping re-exported for existing tests/callers.
  draftToOrderBody: mapper.draftToOrderBody, draftLines: mapper.draftLines, composeLocation: mapper.composeLocation,
  missingFor: mapper.missingFor, rowMissing: mapper.rowMissing, hasRequiredGaps: mapper.hasRequiredGaps,
  REQUIRED: mapper.REQUIRED, RECOMMENDED: mapper.RECOMMENDED,
};
