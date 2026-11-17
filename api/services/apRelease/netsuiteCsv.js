// ═══════════════════════════════════════════════════════════════════
// NetSuite-ready CSV for an AP export batch. Pure: no I/O.
//
// One row per vendor bill, in the column names NetSuite's CSV Import
// Assistant maps for Vendor Bills (Transactions → Purchases → Vendor
// Bill). AP imports the file; Zoree never writes to NetSuite during the
// pilot.
//
// Fields the Kestrel Bay data pack does not provide are labelled
// CONFIG_NEEDED instead of being guessed. Set them in api/.env when the
// customer's NetSuite admin supplies them:
//   NETSUITE_SUBSIDIARY=Kestrel Bay Logistics
//   NETSUITE_FREIGHT_EXPENSE_ACCOUNT=5100 Freight In
//   NETSUITE_VENDOR_IDS={"RIDGELINEFREIGHT":"1234","PIONEEREXPRESS":"1240"}
//   NETSUITE_CURRENCY=USD
// ═══════════════════════════════════════════════════════════════════
'use strict';

const CONFIG_NEEDED = 'CONFIG_NEEDED';
// Display brand (APP_BRAND_NAME in api/.env); defaults to Zoree.
const BRAND = () => String(process.env.APP_BRAND_NAME || 'Zoree').trim() || 'Zoree';

const COLUMNS = Object.freeze([
  'External ID', 'Vendor', 'Vendor Internal ID', 'Reference No.', 'Date', 'Due Date', 'Currency',
  'Subsidiary', 'Expense Account', 'Amount', 'Memo', 'Shipment', 'TMS Invoice ID',
  'Release Path', 'Released By', 'Released At', 'Export Batch',
]);

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fixed = (n) => r2(n).toFixed(2);

function cell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  // Quote anything that could break the row; neutralise spreadsheet formulas.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Stable NetSuite External ID: same bill → same id, so a re-import updates instead of duplicating. */
function externalIdFor({ domainCode, carrierKey, invoiceNumber }) {
  const num = String(invoiceNumber || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  // Prefix is the brand (NETSUITE_EXTERNAL_ID_PREFIX); keep it fixed once a
  // client imports, since NetSuite matches re-imports on this ID.
  const prefix = String(process.env.NETSUITE_EXTERNAL_ID_PREFIX || 'ZOREE').trim().toUpperCase() || 'ZOREE';
  return `${prefix}-${String(domainCode || 'ZOREE').toUpperCase()}-${carrierKey}-${num}`;
}

function config(env = process.env) {
  let vendorIds = {};
  try { vendorIds = env.NETSUITE_VENDOR_IDS ? JSON.parse(env.NETSUITE_VENDOR_IDS) : {}; } catch { vendorIds = {}; }
  return {
    subsidiary: String(env.NETSUITE_SUBSIDIARY || '').trim() || CONFIG_NEEDED,
    expenseAccount: String(env.NETSUITE_FREIGHT_EXPENSE_ACCOUNT || '').trim() || CONFIG_NEEDED,
    currency: String(env.NETSUITE_CURRENCY || 'USD').trim(),
    vendorIds,
  };
}

/** Which NetSuite settings are still missing (shown in the UI next to the export). */
function missingConfig(env = process.env, carrierKeys = []) {
  const c = config(env);
  const out = [];
  if (c.subsidiary === CONFIG_NEEDED) out.push('Subsidiary (NETSUITE_SUBSIDIARY)');
  if (c.expenseAccount === CONFIG_NEEDED) out.push('Freight expense account (NETSUITE_FREIGHT_EXPENSE_ACCOUNT)');
  const noVendor = [...new Set(carrierKeys)].filter((k) => !c.vendorIds[k]);
  if (noVendor.length) out.push(`Vendor internal IDs for ${noVendor.join(', ')} (NETSUITE_VENDOR_IDS)`);
  return out;
}

const iso = (d) => (d ? String(d).slice(0, 10) : '');

/**
 * @param {object} batch  { id, ... }
 * @param {object[]} items ap_export_batch_items rows (ordered by line_no)
 * @returns {{csv:string, total:number, count:number}}
 */
function buildCsv({ batch, items, env = process.env }) {
  const c = config(env);
  const rows = items.map((it) => [
    it.external_id, it.carrier, c.vendorIds[it.carrier_key] || CONFIG_NEEDED, it.invoice_number,
    iso(it.invoice_date), iso(it.due_date), c.currency, c.subsidiary, c.expenseAccount, fixed(it.amount),
    `Freight ${it.shipment_ref || ''} · audited by ${BRAND()} (${it.release_path})`.replace(/\s+·/, ' ·'),
    it.shipment_ref || '', it.invoice_id, it.release_path, it.released_by, it.released_at ? new Date(it.released_at).toISOString() : '',
    batch.id,
  ]);
  const csv = [COLUMNS, ...rows].map((line) => line.map(cell).join(',')).join('\r\n') + '\r\n';
  const total = r2(items.reduce((s, it) => s + r2(it.amount), 0));
  return { csv, total, count: items.length };
}

module.exports = { COLUMNS, CONFIG_NEEDED, externalIdFor, config, missingConfig, buildCsv, cell };
