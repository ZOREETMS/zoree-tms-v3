// ═══════════════════════════════════════════════════════════════════
// One invoice document in detail, for the review drawer:
//   fields    what Zoree AI read from the PDF
//   lines     each charge billed vs what the TMS and contract expect
//   checks    what passed and what did not
//   activity  who did what, in order
// Read-only. The audit is re-run from current data so the drawer always
// shows today's contract rate and approvals.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const db = require('../supabase');
const repo = require('./intakeRepository');
const intakeLog = require('./intakeLog');
const intakeFiles = require('./intakeFiles');
const freightAudit = require('../agents/freightAudit');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const TOLERANCE_USD = 1;
const SOURCE = { email: 'AP mailbox', pdf_upload: 'PDF upload' };

function approvedAmount(a) {
  if (a.max_hours != null && a.rate_per_hour != null) return r2(Number(a.max_hours) * Number(a.rate_per_hour));
  return r2(a.max_amount);
}

/**
 * Pure: each invoice line next to what was expected.
 * status: match | over | not_approved | no_reference
 * @param {{ lines:object[], expected:object|null, approvals?:object[], hasShipment:boolean }} args
 */
function compareLines({ lines, expected, approvals = [], hasShipment }) {
  const approved = new Map();
  for (const a of approvals) {
    if (a.status && a.status !== 'approved' && a.status !== 'Approved') continue;
    approved.set(a.accessorial_type, r2((approved.get(a.accessorial_type) || 0) + approvedAmount(a)));
  }
  return (lines || []).map((l) => {
    const billed = r2(l.invoice_cost);
    const row = { description: l.description || l.cost_type, type: l.cost_type, billed, expected: null, difference: null, status: 'no_reference', note: 'No shipment in the TMS to check against' };
    if (!hasShipment || !expected) return row;
    if (l.cost_type === 'base') { row.expected = expected.base; row.note = 'Contract rate'; }
    else if (l.cost_type === 'fuel_surcharge') { row.expected = expected.fuel; row.note = expected.fuelSource === 'eia' ? `EIA fuel bracket (${expected.eiaFscPct}%)` : 'Fuel on the rated shipment'; }
    else {
      const ok = approved.get(l.accessorial_type);
      row.expected = ok == null ? 0 : ok;
      row.note = ok == null ? 'No approval for this extra on the shipment' : 'Approved on the shipment in the TMS';
    }
    row.difference = r2(billed - row.expected);
    if (row.difference <= TOLERANCE_USD) row.status = 'match';
    else row.status = row.expected === 0 && l.cost_type !== 'base' && l.cost_type !== 'fuel_surcharge' ? 'not_approved' : 'over';
    return row;
  });
}

/**
 * Pure: the fields read from the PDF, in display order, each with the
 * agent's confidence for that field (null when the read predates it).
 */
function fieldsOf(row) {
  const x = row.raw_extraction || {};
  const fc = x.fieldConfidence || {};
  return [
    ['Invoice number', 'invoiceNumber', x.invoiceNumber || row.invoice_number],
    ['Carrier', 'carrier', x.carrier || row.carrier],
    ['Shipment reference', 'shipmentRef', x.shipmentRef || row.shipment_ref],
    ['PRO / BOL', 'proNumber', x.proNumber],
    ['Invoice date', 'invoiceDate', x.invoiceDate],
    ['Origin', 'origin', x.origin],
    ['Destination', 'destination', x.destination],
    ['Total', 'total', x.total != null ? x.total : row.total],
  ].filter(([, , v]) => v !== undefined && v !== null && v !== '')
    .map(([label, key, value]) => ({ label, key, value, confidence: fc[key] != null ? fc[key] : null }));
}

/** The email a document arrived in, if it came by email (domain-scoped lookup). */
async function sourceEmailOf(row) {
  if (row.source !== 'email') return null;
  const { data, error } = await db.getClient().from('email_order_intake')
    .select('from_address,from_name,subject,received_at,attachment_names,mailbox')
    .contains('extracted', { invoice_intakes: [{ intakeId: row.id }] })
    .limit(1);
  if (error || !data || !data[0]) return null;
  const e = data[0];
  return { from: e.from_address, fromName: e.from_name, subject: e.subject, receivedAt: e.received_at, attachments: e.attachment_names || [], mailbox: e.mailbox };
}

const cleanReason = (r) => String(r || '').replace(/^\[Zoree AI[^\]]*\]\s*/, '').trim();

/** One history row in plain words, with the reason recorded for it. */
function activityText(c) {
  const reason = cleanReason(c.metadata && c.metadata.reason);
  if (c.action === 'create') return 'Invoice created from the document';
  if (c.field === 'sent_to_ap_at') return 'Added to the ready-to-post list for AP';
  if (c.field === 'ap_release') return `Released by AP for the NetSuite export (${String(c.new_value || '').replace(/_/g, ' ')})${reason ? `. Note: ${reason}` : ''}`;
  if (c.field === 'ap_export') return `Exported in ${c.new_value} — AP imports the CSV into NetSuite`;
  if (c.field === 'status') return `Status ${c.old_value || '—'} → ${c.new_value}${reason ? `. Reason: ${reason}` : ''}`;
  return `${c.field || c.action}: ${c.old_value || '—'} → ${c.new_value || '—'}${reason ? `. Reason: ${reason}` : ''}`;
}

async function get(id) {
  const row = await repo.getById(id);
  if (!row) { const e = new Error('Document not found in this domain'); e.status = 404; throw e; }
  const invoiceId = row.invoice_id || row.duplicate_of_invoice_id;
  const invRows = invoiceId ? await db.dbSelect('invoices', { filters: [['id', 'eq', invoiceId]], limit: 1 }) : [];
  const invoice = invRows[0] || null;
  const own = row.invoice_id ? invoice : null; // a duplicate points at the original, it has no invoice of its own

  let lines; let audit = null; let shipments = [];
  if (own) {
    const r = await freightAudit.auditOne(own);
    shipments = r.shipments || [];
    lines = compareLines({ lines: r.lines, expected: r.expected, approvals: r.approvals, hasShipment: shipments.length > 0 });
    audit = { verdict: r.audit.verdict, issues: r.audit.issues || [], passed: r.audit.passed || [], recoverable: r.audit.recoverable || 0, payAmount: r.audit.payAmount };
  } else {
    lines = ((row.raw_extraction || {}).lines || []).map((l) => ({ description: l.description, type: l.category, billed: r2(l.amount), expected: null, difference: null, status: 'not_checked', note: 'Not audited — no invoice was created' }));
  }

  const history = own ? await db.dbSelect('change_history', { filters: [['entity_id', 'eq', own.id]], order: { col: 'created_at', asc: true }, limit: 100 }) : [];
  const activity = [
    { at: row.created_at, who: 'Zoree AI', text: `Received by ${SOURCE[row.source] || row.source} and read (${row.model || 'model'}, confidence ${row.read_confidence != null ? Math.round(row.read_confidence * 100) + '%' : 'n/a'})` },
    ...history.map((c) => ({ at: c.created_at, who: c.username || 'system', text: activityText(c) })),
  ];

  return {
    entry: intakeLog.entry(row, own, shipments[0] || null),
    invoice: invoice ? { id: invoice.id, status: invoice.status, agreedCost: invoice.agreed_cost, invoicedAmount: invoice.invoiced_amount, variance: invoice.variance, decisionReason: invoice.decision_reason, decidedBy: invoice.decided_by } : null,
    isDuplicate: row.status === 'duplicate',
    senderCheck: (() => {
      const m = (own && own.metadata && own.metadata.intake) || {};
      return m.sender_verification ? { sender: m.sender || null, status: m.sender_verification, detail: m.sender_detail || null, auth: m.sender_auth || {} } : null;
    })(),
    hasFile: await intakeFiles.exists(row.id).catch(() => false),
    sourceEmail: await sourceEmailOf(row).catch(() => null),
    shipment: shipments[0] ? { id: shipments[0].id, status: shipments[0].status, carrier: shipments[0].carrier, origin: shipments[0].origin, destination: shipments[0].dest || shipments[0].destination } : null,
    fields: fieldsOf(row),
    warnings: [...(row.read_warnings || []), ...(row.problems || [])],
    lines,
    audit,
    activity,
  };
}

module.exports = { get, compareLines, fieldsOf, activityText };
