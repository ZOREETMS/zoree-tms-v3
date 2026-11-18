// ═══════════════════════════════════════════════════════════════════
// Freight Audit Agent
//   input : { invoiceId }  or  { scan: true, limit? }  (Rejected / On Hold invoices)
//   plan  : invoice + cost lines vs rated shipment (+ EIA fuel) → issues, $ recoverable
//   action: APPROVE_INVOICE  clean and under the AP limit → approved, added to
//                            the ready-to-post list (auto when the policy tier
//                            allows it and the agent is not in shadow mode)
//           APPROVE_INVOICE  clean but over the AP limit → a person approves
//           DISPUTE_INVOICE  anything it cannot clear goes to a person with the
//                            reason: short-pay, void, duplicate, or hold for
//                            BOL/POD (status Disputed / On Hold + carrier email)
// AP rules live in ./apPolicy (limit, ERP read-only, change-freeze shadow mode).
// REQ-06 (invoiceAudit.decideInvoice) stays the authority for the
// tolerance check; this agent explains and acts on what it rejects.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const db = require('../../supabase');
const invoiceAudit = require('../../invoiceAudit');
const costLines = require('../../invoiceCostLines');
const accessorialApprovals = require('../../accessorialApprovals');
const { getCurrentDieselPrice } = require('../../eiaFuelService');
const { getSchedulesByCarrier, lookupFscPct } = require('../../fscSchedule');
const { sendAgentMessage } = require('../outbound/outboundMessage');
const { expectedCharges, auditInvoice, buildDisputeEmail, carrierKey, money, r2 } = require('./auditRules');
const { getApPolicy } = require('./apPolicy');

const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const SCAN_STATUSES = ['Rejected', 'On Hold'];
// Superseded (migration 058): an original replaced by its corrected revision —
// kept for history, never a second bill.
const CLOSED = new Set(['Cancelled', 'Superseded']);
const PAID_OUT = new Set(['Approved', 'Paid']);

function validateInput(i) {
  if (i.invoiceId) return { invoiceId: String(i.invoiceId).trim() };
  return { scan: true, limit: Math.min(Number(i.limit) || 5, 25) };
}

const shipmentIdsOf = (inv) => (Array.isArray(inv.shipment_ids) && inv.shipment_ids.length ? inv.shipment_ids : (inv.shipment_id ? [inv.shipment_id] : []));

async function loadInvoices(input) {
  if (input.invoiceId) {
    const rows = await db.dbSelect('invoices', { filters: [['id', 'eq', input.invoiceId]], limit: 1 });
    if (!rows.length) throw bad(`Invoice not found: ${input.invoiceId}`, 404);
    return rows;
  }
  const rows = await db.dbSelect('invoices', { filters: [['status', 'in', SCAN_STATUSES]], order: { col: 'received_at', asc: false }, limit: 100 });
  // Linked invoices first — those are the ones the agent can actually audit.
  return rows.sort((a, b) => (shipmentIdsOf(b).length ? 1 : 0) - (shipmentIdsOf(a).length ? 1 : 0)).slice(0, input.limit);
}

async function eiaPctFor(carrierName) {
  const rows = await db.dbSelect('carriers', { select: 'id,name,eia_fsc_enabled,contact_email,email', filters: [['name', 'eq', String(carrierName || '').toUpperCase()]], limit: 1 });
  const carrier = rows[0] || null;
  if (!carrier || !carrier.eia_fsc_enabled) return { carrier, pct: null };
  try {
    const [price, schedules] = await Promise.all([getCurrentDieselPrice(), getSchedulesByCarrier([carrier.id])]);
    return { carrier, pct: price ? lookupFscPct(schedules[carrier.id], parseFloat(price.price_usd_per_gallon)) : null };
  } catch { return { carrier, pct: null }; }
}

/**
 * Pay once: another copy counts against this invoice only if it was already
 * approved/paid, or arrived first. So of two open copies the earlier one is
 * the original (audited normally) and the later one is the duplicate.
 */
function isEarlierCopy(other, invoice) {
  if (PAID_OUT.has(other.status)) return true;
  const a = Date.parse(other.received_at || 0);
  const b = Date.parse(invoice.received_at || 0);
  return a < b || (a === b && String(other.id) < String(invoice.id));
}

/** Disputed or held originals this invoice is a corrected copy of (set by PDF intake). */
const replacedBy = (inv) => new Set(((inv.metadata && inv.metadata.intake && inv.metadata.intake.replaces) || []).map((r) => r.id));
/** A shipment-row draft nobody approved is an estimate, not a carrier bill. */
const isOpenDraft = (s) => Boolean(s.metadata && s.metadata.created_from === 'shipment') && !PAID_OUT.has(s.status);

async function auditOne(invoice, policy = getApPolicy()) {
  const sids = shipmentIdsOf(invoice);
  const sibSelect = 'id,invoice_number,carrier,status,shipment_id,invoiced_amount,received_at,decided_at,metadata';
  const [lines, shipments, byShipment, byNumber, fuel, approvals] = await Promise.all([
    costLines.listForInvoice(invoice.id),
    sids.length ? db.dbSelect('shipments', { filters: [['id', 'in', sids]], limit: sids.length }) : [],
    invoice.shipment_id ? db.dbSelect('invoices', { select: sibSelect, filters: [['shipment_id', 'eq', invoice.shipment_id]], limit: 20 }) : [],
    // Same invoice number from the same carrier = a resend, even if it names a different shipment.
    invoice.invoice_number ? db.dbSelect('invoices', { select: sibSelect, filters: [['invoice_number', 'eq', invoice.invoice_number]], limit: 20 }) : [],
    eiaPctFor(invoice.carrier),
    accessorialApprovals.listForShipments(sids),
  ]);
  const sameCarrier = byNumber.filter((s) => carrierKey(s.carrier) === carrierKey(invoice.carrier));
  const siblings = [...new Map([...byShipment, ...sameCarrier].map((s) => [s.id, s])).values()]
    .filter((s) => s.id !== invoice.id && !CLOSED.has(s.status) && isEarlierCopy(s, invoice)
      // A disputed or held original this invoice corrects is not a second
      // bill — but only while it is still Disputed / On Hold; approved or
      // paid it counts again.
      && !(replacedBy(invoice).has(s.id) && (s.status === 'Disputed' || s.status === 'On Hold')) && !isOpenDraft(s));
  const expected = expectedCharges(shipments, { eiaFscPct: fuel.pct });
  const audit = auditInvoice({ invoice, lines, shipments, siblings, expected, approvals, policy });
  return { invoice, lines, shipments, expected, approvals, audit, carrierEmail: fuel.carrier && (fuel.carrier.contact_email || fuel.carrier.email) };
}

const firstIssue = (audit) => (audit.issues[0] && audit.issues[0].detail) || '';

function routeToPerson(r) {
  const inv = r.invoice;
  const label = inv.invoice_number || inv.id;
  const mail = buildDisputeEmail({ invoice: inv, carrier: inv.carrier, audit: r.audit, shipments: r.shipments });
  const hold = r.audit.payAmount === 0 && r.audit.recoverable === 0;
  const title = r.audit.payAmount > 0
    ? `Short-pay ${label} (${inv.carrier}) — pay ${money(r.audit.payAmount)}, dispute ${money(r.audit.recoverable)}`
    : hold ? `Hold ${label} (${inv.carrier}) — ${firstIssue(r.audit)}`
      : `Do not pay ${label} (${inv.carrier}) — dispute ${money(r.audit.recoverable)}`;
  return {
    type: 'DISPUTE_INVOICE', title, requireApproval: true, // AP rule: every dispute or hold goes to a person
    entityType: 'invoice', entityId: inv.id, dedupe: `${r.audit.verdict}:${r.audit.recoverable}`,
    payload: { invoiceId: inv.id, carrier: inv.carrier, decision: hold ? 'On Hold' : 'Disputed', to: r.carrierEmail || null, recoverable: r.audit.recoverable, payAmount: r.audit.payAmount, reason: r.audit.issues.map((i) => i.detail).join(' '), subject: mail.subject, body: mail.body, issues: r.audit.issues },
  };
}

function actionFor(r, policy) {
  const inv = r.invoice;
  const label = inv.invoice_number || inv.id;
  if (r.audit.verdict === 'approve' || r.audit.verdict === 'review') {
    if (inv.status === 'Approved') return null;
    const overLimit = r.audit.verdict === 'review';
    const where = policy.erpReadOnly ? ' Added to the NetSuite ready-to-post list for AP (NetSuite is read-only in the pilot).' : '';
    return {
      type: 'APPROVE_INVOICE', requireApproval: overLimit || policy.shadowMode,
      title: overLimit
        ? `Approve ${label} (${inv.carrier})? Every line matches, but ${money(inv.invoiced_amount)} is over the ${money(policy.approvalLimitUsd)} limit`
        : `Approve ${label} (${inv.carrier}) — every line matches the contract`,
      entityType: 'invoice', entityId: inv.id, dedupe: String(inv.invoiced_amount),
      payload: { invoiceId: inv.id, carrier: inv.carrier, reason: `Line-level audit by Zoree AI: billed ${money(inv.invoiced_amount)} matches rated ${money(r.expected.total)}.${where}` },
    };
  }
  return routeToPerson(r);
}

/** What AP posts in NetSuite, now or once a person signs off. */
function readyToPost(results) {
  return results
    .filter((r) => r.audit.verdict === 'approve' || r.audit.verdict === 'review' || (r.audit.verdict === 'dispute' && r.audit.payAmount > 0))
    .map((r) => ({
      invoiceId: r.invoice.id, number: r.invoice.invoice_number, carrier: r.invoice.carrier, shipments: r.shipments.map((s) => s.id),
      billed: r2(r.invoice.invoiced_amount), payAmount: r.audit.verdict === 'dispute' ? r.audit.payAmount : r2(r.invoice.invoiced_amount),
      basis: r.audit.verdict === 'approve' ? 'Clean' : r.audit.verdict === 'review' ? 'Clean, over limit — after approval' : `Short-pay — after approval (disputing ${money(r.audit.recoverable)})`,
    }));
}

function summarize(results, policy) {
  const count = (v) => results.filter((r) => r.audit.verdict === v).length;
  const toPerson = results.filter((r) => r.audit.toPerson).length;
  const recoverable = results.reduce((s, r) => s + (r.audit.verdict === 'dispute' ? r.audit.recoverable : 0), 0);
  return [
    policy.shadowMode ? 'Shadow mode (change freeze): suggestions only' : null,
    `${results.length} invoice(s) audited`,
    count('approve') ? `${count('approve')} clean` : null,
    toPerson ? `${toPerson} to a person` : null,
    recoverable ? `${money(recoverable)} not payable as billed` : null,
  ].filter(Boolean).join(' · ');
}

async function plan(input) {
  const policy = getApPolicy();
  const invoices = await loadInvoices(input);
  if (!invoices.length) return { summary: 'No rejected or on-hold invoices to audit.', actions: [] };
  const results = [];
  for (const inv of invoices) results.push(await auditOne(inv, policy)); // eslint-disable-line no-await-in-loop
  const recoverable = results.reduce((s, r) => s + (r.audit.verdict === 'dispute' ? r.audit.recoverable : 0), 0);
  return {
    summary: summarize(results, policy),
    entityType: 'invoice', entityId: results.length === 1 ? results[0].invoice.id : null,
    findings: {
      recoverable,
      policy,
      counts: { total: results.length, clean: results.filter((r) => r.audit.verdict === 'approve').length, toPerson: results.filter((r) => r.audit.toPerson).length },
      readyToPost: readyToPost(results),
      invoices: results.map((r) => ({
        id: r.invoice.id, number: r.invoice.invoice_number, carrier: r.invoice.carrier, status: r.invoice.status,
        billed: r.invoice.invoiced_amount, rated: r.expected.total, expected: r.expected,
        lines: r.lines.map((l) => ({ type: l.cost_type, description: l.description, amount: l.invoice_cost })),
        shipments: r.shipments.map((s) => s.id), ...r.audit,
      })),
    },
    actions: results.map((r) => actionFor(r, policy)).filter(Boolean),
  };
}

const executors = {
  DISPUTE_INVOICE: async (p, ctx) => {
    const decision = p.decision === 'On Hold' ? 'On Hold' : 'Disputed';
    const updated = await invoiceAudit.manualDecide({ invoiceId: p.invoiceId, decision, reason: `[Zoree AI · Freight Audit] ${p.reason}`.slice(0, 1000), user: ctx.user });
    const mail = await sendAgentMessage({ audience: 'carrier', messageType: 'INVOICE', to: p.to, subject: p.subject, body: p.body, externalRef: p.invoiceId }, ctx);
    return { invoiceId: p.invoiceId, status: updated && updated.status, mail };
  },
  APPROVE_INVOICE: async (p, ctx) => {
    const updated = await invoiceAudit.manualDecide({ invoiceId: p.invoiceId, decision: 'Approved', reason: p.reason, user: ctx.user });
    return { invoiceId: p.invoiceId, status: updated && updated.status };
  },
};

module.exports = {
  key: 'freight_audit', validateInput, plan, executors,
  auditOne, // used by invoice PDF intake to line-audit a just-created invoice
  editableFields: { DISPUTE_INVOICE: ['to', 'subject', 'body', 'reason'], APPROVE_INVOICE: ['reason'] },
  // exported for tests
  isEarlierCopy, readyToPost, actionFor,
};
