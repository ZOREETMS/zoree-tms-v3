// ═══════════════════════════════════════════════════════════════════
// Domains (migration 052) — constants shared by the domain services.
//
// A domain is a client's data partition (OTM-style). Every row in a
// SCOPED table belongs to exactly one domain (column domain_code).
// Child tables (order_lines, shipment_legs, invoice_cost_lines,
// shipment_accessorial_approvals …) inherit through their parent.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const DEFAULT_DOMAIN = 'ZOREE';
const DOMAIN_HEADER = 'x-zoree-domain';
const CODE_RE = /^[A-Z0-9_]{2,32}$/;

const SCOPED_TABLES = new Set([
  'orders', 'shipments', 'invoices', 'carriers', 'rates', 'locations',
  'items', 'documents', 'invoice_intakes', 'invoice_intake_runs', 'email_order_intake', 'agent_runs',
  // migration 054: AP release & NetSuite export
  'invoice_ap_releases', 'ap_export_batches', 'ap_export_batch_items', 'ap_audit_events',
]);

/** DOMAIN_SCOPING=off in api/.env turns all filtering off (rollback switch). */
function isScopingEnabled() {
  return String(process.env.DOMAIN_SCOPING || 'on').toLowerCase() !== 'off';
}

function normalizeCode(raw) {
  const c = String(raw || '').trim().toUpperCase();
  return CODE_RE.test(c) ? c : null;
}

module.exports = { DEFAULT_DOMAIN, DOMAIN_HEADER, SCOPED_TABLES, isScopingEnabled, normalizeCode };
