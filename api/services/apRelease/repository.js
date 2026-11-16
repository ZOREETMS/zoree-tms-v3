// ═══════════════════════════════════════════════════════════════════
// AP release repository — the only module that reads or writes the
// migration-054 tables. Every table here is domain-scoped
// (domains/domainCodes.js), so reads and inserts only ever see the
// current request's domain. The export itself is one RPC
// (ap_create_export_batch) so a batch is written all-or-nothing.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const db = require('../supabase');
const { currentDomain } = require('../domains/domainContext');

const INVOICE_SELECT = 'id,invoice_number,carrier,carrier_id,shipment_id,shipment_ids,status,invoiced_amount,agreed_cost,variance,invoice_date,due_date,decided_by,decided_at,decision_reason,sent_to_ap_at,created_at,domain_code,metadata';

function fail(table, error, verb) {
  const e = new Error(`[DB] ${table} ${verb} failed: ${error.message}`);
  e.code = error.code;
  // Append-only triggers and the export RPC raise P0001 with a readable message.
  if (error.code === 'P0001' || error.code === '23505') {
    e.status = 409;
    e.message = String(error.message || '').replace(/^AP_[A-Z_]+:\s*/, '');
    if (error.code === '23505') {
      e.message = /ap_release_bill_once/.test(error.message)
        ? 'This carrier invoice number is already released under another record — a resend is never paid twice.'
        : /ap_export_items|invoice_ap_releases_pkey/.test(error.message)
          ? 'Already released or exported — an invoice can never be exported twice.'
          : e.message;
    }
  }
  return e;
}

async function insert(table, rows) {
  const { data, error } = await db.getClient().from(table).insert(rows).select();
  if (error) throw fail(table, error, 'insert');
  return data || [];
}

const getInvoice = async (id) => (await db.dbSelect('invoices', { select: INVOICE_SELECT, filters: [['id', 'eq', id]], limit: 1 }))[0] || null;
const listInvoicesByIds = (ids) => (ids.length ? db.dbSelect('invoices', { select: INVOICE_SELECT, filters: [['id', 'in', ids]], limit: ids.length }) : Promise.resolve([]));
const listInvoicesByStatuses = (statuses) => db.dbSelect('invoices', { select: INVOICE_SELECT, filters: [['status', 'in', statuses]], order: { col: 'created_at', asc: true }, limit: 500 });
const listApprovedInvoices = () => listInvoicesByStatuses(['Approved']);
/** Invoices that share a carrier invoice number with any of `numbers` (resend / duplicate check). */
const listInvoicesByNumbers = (numbers) => (numbers.length ? db.dbSelect('invoices', { select: 'id,invoice_number,carrier,status', filters: [['invoice_number', 'in', numbers]], limit: 500 }) : Promise.resolve([]));

const listReleases = (invoiceIds = null) => db.dbSelect('invoice_ap_releases', {
  filters: invoiceIds ? [['invoice_id', 'in', invoiceIds]] : [], order: { col: 'released_at', asc: true }, limit: 1000,
});
/**
 * Resolve a held invoice in one transaction (migration 055): status +
 * decision fields, change_history rows and the AP ledger entry together.
 */
async function resolveException(a) {
  const { data, error } = await db.getClient().rpc('ap_resolve_exception', {
    p_domain: currentDomain(), p_invoice_id: a.invoiceId, p_decision: a.decision, p_reason: a.reason,
    p_by: a.by, p_by_id: a.byId || null, p_role: a.role || null, p_history: a.history || [],
    p_event_type: a.eventType, p_detail: a.detail, p_payload: a.payload || {},
  });
  if (error) throw fail('ap_resolve_exception', error, 'rpc');
  return data;
}

const getRelease = async (invoiceId) => (await listReleases([invoiceId]))[0] || null;

/**
 * Release one invoice in one transaction (migration 055): locks the invoice,
 * refuses if status / amount / approval changed since the revalidation,
 * writes the release and its ledger entry together.
 */
async function releaseInvoice(a) {
  const { data, error } = await db.getClient().rpc('ap_release_invoice', {
    p_domain: currentDomain(), p_invoice_id: a.invoiceId, p_path: a.path, p_by: a.by, p_by_id: a.byId || null,
    p_role: a.role || null, p_note: a.note || null, p_exception_by: a.exceptionBy || null,
    p_justification: a.justification || null, p_verdict: a.verdict, p_expected_amount: a.expectedAmount,
    p_expected_decided_by: a.expectedDecidedBy == null ? null : a.expectedDecidedBy,
    p_expected_decided_at: a.expectedDecidedAt == null ? null : a.expectedDecidedAt,
    p_carrier_key: a.carrierKey, p_invoice_number_key: a.invoiceNumberKey,
    p_event_type: a.eventType, p_detail: a.detail, p_payload: a.payload || {},
  });
  if (error) throw fail('ap_release_invoice', error, 'rpc');
  return data;
}

const listExportItems = ({ invoiceIds = null, batchIds = null } = {}) => {
  const filters = [];
  if (invoiceIds) filters.push(['invoice_id', 'in', invoiceIds]);
  if (batchIds) filters.push(['batch_id', 'in', batchIds]);
  return db.dbSelect('ap_export_batch_items', { filters, order: { col: 'line_no', asc: true }, limit: 2000 });
};

const BATCH_LIST_SELECT = 'id,domain_code,status,target_system,file_name,invoice_count,total_amount,created_by,confirmed_by,confirmed_at,import_reference,csv_sha256,created_at';
const listBatches = (limit = 50) => db.dbSelect('ap_export_batches', { select: BATCH_LIST_SELECT, order: { col: 'created_at', asc: false }, limit });
const getBatch = async (id) => (await db.dbSelect('ap_export_batches', { filters: [['id', 'eq', id]], limit: 1 }))[0] || null;

/** AP's "we imported it" — status change and ledger entry in one transaction (migration 055). */
async function confirmImport({ batchId, by, role, reference }) {
  const { data, error } = await db.getClient().rpc('ap_confirm_import', {
    p_domain: currentDomain(), p_batch_id: batchId, p_by: by, p_role: role || null, p_reference: reference || null,
  });
  if (error) throw fail('ap_confirm_import', error, 'rpc');
  return data;
}

const insertAuditEvents = (rows) => (rows.length ? insert('ap_audit_events', rows) : Promise.resolve([]));
const listAudit = ({ invoiceId = null, batchId = null }) => db.dbSelect('ap_audit_events', {
  filters: invoiceId ? [['invoice_id', 'eq', invoiceId]] : [['batch_id', 'eq', batchId]],
  order: { col: 'created_at', asc: true }, limit: 500,
});

/** All-or-nothing export (migrations 054/055); stores the exact CSV + SHA-256. */
async function createExportBatch({ batchId, fileName, createdBy, actorRole, items, csv, sha256 }) {
  const { data, error } = await db.getClient().rpc('ap_create_export_batch', {
    p_domain: currentDomain(), p_batch_id: batchId, p_file_name: fileName,
    p_created_by: createdBy, p_actor_role: actorRole || null, p_items: items, p_csv: csv, p_csv_sha256: sha256,
  });
  if (error) throw fail('ap_create_export_batch', error, 'rpc');
  return data;
}

module.exports = {
  currentDomain,
  getInvoice, listInvoicesByIds, listInvoicesByStatuses, listApprovedInvoices, listInvoicesByNumbers,
  resolveException, listReleases, getRelease, releaseInvoice,
  listExportItems, listBatches, getBatch, confirmImport, createExportBatch,
  insertAuditEvents, listAudit,
};
