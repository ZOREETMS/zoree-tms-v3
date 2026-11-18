// ═══════════════════════════════════════════════════════════════════
// Invoice intake log — every carrier invoice document received for the
// current domain and what happened to it, including the ones that never
// became an invoice (a resend, an unreadable scan).
//
// Outcomes AP sees:
//   ready_to_post  clean (or approved by AP): on the ready-to-post list
//   needs_review   an invoice exists but a person has to decide
//   disputed       AP disputed or rejected it with the carrier
//   deleted        an invoice was created, then someone deleted it
//   duplicate      already received — nothing created, pay once
//   needs_manual   the read could not be trusted — a person keys it
//   failed         processing stopped
// ═══════════════════════════════════════════════════════════════════
'use strict';

const db = require('../supabase');
const repo = require('./intakeRepository');
const runRepo = require('./runRepository');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Pure: the AP outcome of one intake row, given its invoice (if any). */
function outcomeOf(row, invoice) {
  if (row.status === 'created') {
    if (!row.invoice_id) return 'deleted'; // the FK is cleared when the invoice is deleted
    if (invoice && ['Approved', 'Paid'].includes(invoice.status)) return 'ready_to_post';
    if (invoice && ['Disputed', 'Rejected'].includes(invoice.status)) return 'disputed';
    // Replaced by a corrected revision (migration 058): kept for history, never payable.
    if (invoice && invoice.status === 'Superseded') return 'superseded';
    return 'needs_review';
  }
  return ['duplicate', 'needs_manual', 'failed'].includes(row.status) ? row.status : 'needs_review';
}

/**
 * Pure: why the document ended where it did. The agent's own finding,
 * unless a person in AP has since approved an invoice the agent held.
 */
function reasonOf(row, invoice, outcome) {
  const agent = row.outcome_reason || null;
  if (outcome === 'deleted') return `The invoice was deleted after it was read. Agent finding at the time: ${agent || '—'}`;
  if (outcome === 'superseded') return `${invoice.decision_reason || 'Superseded by a corrected revision.'} Agent finding on this version: ${agent || '—'}`;
  if (invoice && /Needs AP review/i.test(agent || '') && (outcome === 'ready_to_post' || outcome === 'disputed')) {
    const verb = outcome === 'disputed' ? invoice.status : 'Approved';
    return `${verb} by AP${invoice.decided_by ? ` (${invoice.decided_by})` : ''}${invoice.decision_reason ? `: ${invoice.decision_reason}` : ''}. Agent finding: ${agent}`;
  }
  return agent;
}

// Accounts that are the agent, not a person (decisions they make are not "reviews").
const AGENT_USERS = new Set(['invoice-intake-agent', 'verify-run', 'system', 'freight-audit-agent']);
const isAgent = (who) => !who || AGENT_USERS.has(String(who)) || /agent/i.test(String(who));

/**
 * Pure: how risky a held invoice is, for the approval queue.
 *   critical  sender not verified (possible fraud)
 *   high      shipment not in the TMS, or the shipment is cancelled
 *   medium    billed above the agreed cost (overbilling, unapproved extras)
 *   low       anything else (e.g. over the auto-approve limit, freeze)
 * @param {{ invoice?:object, shipment?:object|null }} ctx
 */
function riskOf({ invoice, shipment }) {
  if (!invoice) return null;
  const meta = (invoice.metadata && invoice.metadata.intake) || {};
  if (meta.sender_verification === 'unverified' || meta.sender_verification === 'unregistered') return 'critical';
  const missing = (invoice.metadata && invoice.metadata.missing_shipments) || [];
  if (missing.length || !shipment) return 'high';
  if (String(shipment.status || '').toLowerCase() === 'cancelled') return 'high';
  if (Number(invoice.variance) > 1) return 'medium';
  return 'low';
}

const usd = (n) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Pure: the exception in a few words, for the list. Built from structured
 * facts first; the agent's own reason text only tells an unapproved extra
 * apart from a rate overcharge (both show as a positive variance).
 */
function shortReasonOf({ row, invoice, shipment, outcome, extras = [] }) {
  if (outcome === 'duplicate') return `Resend of ${row.invoice_number || 'an invoice already received'}`;
  if (outcome === 'needs_manual') {
    const p = (row.problems || []).join(' ');
    if (/credit or adjustment/.test(p)) return 'Correction to a posted invoice: credit or adjustment';
    if (/different load/.test(p)) return 'Same number, different shipment';
    if (/was rejected|already closed/.test(p)) return 'Changed copy of a closed invoice';
    return /not a carrier on file/.test(p) ? 'Carrier not on file' : 'Key by hand: read not reliable';
  }
  if (outcome === 'superseded') {
    const by = invoice && invoice.metadata && invoice.metadata.superseded_by;
    return `Superseded by revision${by && by.id ? ` ${by.id}` : ''}: not payable`;
  }
  if (outcome === 'failed') return 'Processing failed';
  if (outcome === 'deleted') return 'Invoice deleted';
  if (!invoice) return null;
  const meta = (invoice.metadata && invoice.metadata.intake) || {};
  const text = `${row.outcome_reason || ''} ${invoice.decision_reason || ''}`;
  const rev = meta.revision_of ? 'Corrected revision · ' : '';
  if (outcome === 'ready_to_post') {
    if (/Needs AP review/i.test(row.outcome_reason || '')) return `${rev}Approved by AP`;
    // Extras billed on a clean invoice passed because they were approved in the TMS.
    const named = extras.map((x) => `${usd(x.amount)} ${String(x.type || 'extra').replace(/_/g, ' ')} approved`);
    return `${rev}${named.length ? `Contract matched; ${named.join(', ')}` : 'Contract matched'}`;
  }
  if (outcome === 'disputed') return `Disputed by AP`;
  const parts = [];
  if (meta.sender_verification === 'unverified' || meta.sender_verification === 'unregistered') parts.push('Sender not verified');
  const missing = (invoice.metadata && invoice.metadata.missing_shipments) || [];
  if (missing.length || !shipment) parts.push('Shipment not in TMS');
  else if (String(shipment.status || '').toLowerCase() === 'cancelled') parts.push('Shipment cancelled');
  const extra = /Extra charges billed \$([\d,]+\.\d{2})/.exec(text);
  if (extra) parts.push(`Unapproved extra ${'$'}${extra[1]}`);
  else if (Number(invoice.variance) > 1 && shipment && String(shipment.status || '').toLowerCase() !== 'cancelled') parts.push(`Over contract ${usd(invoice.variance)}`);
  if (/Shadow mode/i.test(text)) parts.push('Change freeze: recommend approve');
  if (/auto-approve limit/i.test(text)) parts.push('Over $2,500 sign-off');
  return `${rev}${parts.length ? parts.join(' · ') : 'Needs AP review'}`;
}

/**
 * Pure: how a document came in — the agent run that read it (migration 056),
 * else its source (documents read before run logging, single uploads).
 */
function arrivalOf(row, run) {
  if (run) {
    const AUTO = { 'new-email': 'New email', 'catch-up-check': 'Catch-up check', 'backup-check': 'Backup check' };
    const label = run.trigger === 'schedule' ? (AUTO[run.started_by] || 'Scheduled check')
      : run.channel === 'inbox_folder' ? `Inbox folder · ${run.started_by}` : `Read AP Mailbox · ${run.started_by}`;
    return { kind: run.trigger, runId: run.id, label };
  }
  if (row.source === 'email') return { kind: 'email', runId: null, label: 'AP mailbox' };
  return { kind: 'upload', runId: null, label: row.created_by && !isAgent(row.created_by) ? `Upload · ${row.created_by}` : 'Upload' };
}

function entry(row, invoice, shipment, extras = [], run = null) {
  const outcome = outcomeOf(row, invoice);
  return {
    intakeId: row.id, receivedAt: row.created_at, source: row.source, fileName: row.file_name,
    arrival: arrivalOf(row, run),
    invoiceId: row.invoice_id || null, duplicateOfInvoiceId: row.duplicate_of_invoice_id || null,
    invoiceNumber: row.invoice_number, carrier: row.carrier, shipmentRef: row.shipment_ref,
    // The invoice's date, or the date printed on a document that never became one (a resend).
    invoiceDate: (invoice && invoice.invoice_date) || row.read_invoice_date || null,
    // false when the shipment the carrier named is not in the TMS (null: not checked)
    shipmentInTms: invoice ? Boolean(shipment) : null,
    sender: ((invoice && invoice.metadata && invoice.metadata.intake) || {}).sender || null,
    senderStatus: ((invoice && invoice.metadata && invoice.metadata.intake) || {}).sender_verification || null,
    total: row.total, confidence: row.read_confidence,
    outcome,
    invoiceStatus: invoice ? invoice.status : null,
    // Revision links (migration 058): the original this corrects / the revision that replaced it.
    revisionOf: ((invoice && invoice.metadata && invoice.metadata.intake) || {}).revision_of || null,
    supersededBy: (invoice && invoice.metadata && invoice.metadata.superseded_by) || null,
    risk: outcome === 'needs_review' ? riskOf({ invoice, shipment }) : null,
    reason: reasonOf(row, invoice, outcome),
    shortReason: shortReasonOf({ row, invoice, shipment, outcome, extras }),
    problems: row.problems || [],
  };
}

/** Pure: counts and dollars per outcome. */
function summarize(entries) {
  const bucket = () => ({ count: 0, total: 0 });
  const s = { received: entries.length, receivedTotal: 0, avgConfidence: null,
    ready_to_post: bucket(), needs_review: bucket(), disputed: bucket(), superseded: bucket(), deleted: bucket(), duplicate: bucket(), needs_manual: bucket(), failed: bucket() };
  const conf = [];
  for (const e of entries) {
    const b = s[e.outcome] || s.needs_review;
    b.count += 1;
    b.total = round2(b.total + (Number(e.total) || 0));
    s.receivedTotal = round2(s.receivedTotal + (Number(e.total) || 0));
    if (e.confidence != null) conf.push(Number(e.confidence));
  }
  if (conf.length) s.avgConfidence = Math.round((conf.reduce((a, b) => a + b, 0) / conf.length) * 100) / 100;
  return s;
}

/**
 * Pure: approval-queue statistics. A review is a decision a person made
 * (not the agent) on an invoice that came through intake.
 */
function queueStats(entries, invoices, now = Date.now()) {
  const week = now - 7 * 86400000;
  const human = invoices.filter((i) => i.decided_at && !isAgent(i.decided_by));
  const recent = human.filter((i) => Date.parse(i.decided_at) >= week);
  const mins = human.map((i) => (Date.parse(i.decided_at) - Date.parse(i.created_at)) / 60000).filter((m) => Number.isFinite(m) && m >= 0);
  return {
    pending: entries.filter((e) => e.outcome === 'needs_review').length,
    approved7d: recent.filter((i) => ['Approved', 'Paid'].includes(i.status)).length,
    disputed7d: recent.filter((i) => ['Disputed', 'Rejected'].includes(i.status)).length,
    reviewers: new Set(human.map((i) => i.decided_by)).size,
    avgReviewMinutes: mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : null,
  };
}

/** Latest documents first, with a summary over the same rows. */
async function list({ limit = 100, runId = null } = {}) {
  const rows = await repo.listRecent(limit, { runId });
  const runIds = [...new Set(rows.map((r) => r.run_id).filter(Boolean))];
  const runById = new Map((await runRepo.byIds(runIds).catch(() => [])).map((r) => [r.id, r]));
  const ids = [...new Set(rows.map((r) => r.invoice_id).filter(Boolean))];
  const invoices = ids.length
    ? await db.dbSelect('invoices', { select: 'id,status,sent_to_ap_at,decision_reason,decided_by,decided_at,created_at,invoice_date,metadata,variance,shipment_id', filters: [['id', 'in', ids]], limit: ids.length })
    : [];
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const shipIds = [...new Set(invoices.map((i) => i.shipment_id).filter(Boolean))];
  const shipments = shipIds.length
    ? await db.dbSelect('shipments', { select: 'id,status', filters: [['id', 'in', shipIds]], limit: shipIds.length })
    : [];
  const shipById = new Map(shipments.map((s) => [s.id, s]));
  // Billed extras (liftgate, detention …) per invoice, to name them in the list.
  const extraLines = ids.length
    ? await db.dbSelect('invoice_cost_lines', { select: 'invoice_id,cost_type,accessorial_type,invoice_cost', filters: [['invoice_id', 'in', ids]], limit: 2000 })
    : [];
  const extrasById = new Map();
  for (const l of extraLines) {
    if (l.cost_type === 'base' || l.cost_type === 'fuel_surcharge' || !(Number(l.invoice_cost) > 0)) continue;
    if (!extrasById.has(l.invoice_id)) extrasById.set(l.invoice_id, []);
    extrasById.get(l.invoice_id).push({ type: l.accessorial_type || l.cost_type, amount: Number(l.invoice_cost) });
  }
  const entries = rows.map((r) => {
    const inv = byId.get(r.invoice_id);
    return entry(r, inv, inv ? shipById.get(inv.shipment_id) || null : null, inv ? extrasById.get(inv.id) || [] : [], runById.get(r.run_id) || null);
  });
  return { entries, summary: { ...summarize(entries), queue: queueStats(entries, invoices) } };
}

module.exports = { list, outcomeOf, summarize, entry, riskOf, queueStats, shortReasonOf, arrivalOf, _internals: { entry } };
