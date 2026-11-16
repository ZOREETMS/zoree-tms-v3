// ═══════════════════════════════════════════════════════════════════
// Accessorial approvals — the single writer of
// shipment_accessorial_approvals (migration 051).
//
// An approval says "this shipment may be billed this extra": liftgate up
// to $85, detention up to 2 hrs at $75/hr. Freight Audit checks each
// typed extra on a carrier invoice against these rows.
//
// Before migration 051 is applied the table does not exist; reads return
// [] so the audit falls back to shipments.accessorials and nothing breaks.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const db = require('./supabase');
const history = require('./changeHistory');

const TABLE = 'shipment_accessorial_approvals';
const TYPES = Object.freeze(['liftgate', 'detention', 'lumper', 'layover', 'redelivery', 'inside_delivery', 'residential', 'limited_access', 'other']);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };

let warnedMissing = false;
function isMissingTable(err) {
  return /does not exist|schema cache|PGRST205|42P01/i.test(String(err && err.message));
}

/** Max approved dollars for one approval row. */
function approvedAmount(row) {
  if (row.max_hours != null && row.rate_per_hour != null) return r2(Number(row.max_hours) * Number(row.rate_per_hour));
  return r2(row.max_amount);
}

/** Human basis, e.g. "2 hrs × $75.00" or "up to $85.00". */
function basisText(row) {
  if (row.max_hours != null && row.rate_per_hour != null) return `${Number(row.max_hours)} hrs × $${Number(row.rate_per_hour).toFixed(2)}`;
  return `up to $${Number(row.max_amount).toFixed(2)}`;
}

async function listForShipments(shipmentIds) {
  const ids = [...new Set((shipmentIds || []).filter(Boolean))];
  if (!ids.length) return [];
  try {
    return await db.dbSelect(TABLE, { filters: [['shipment_id', 'in', ids]], order: { col: 'approved_at', asc: true }, limit: 200 });
  } catch (e) {
    if (isMissingTable(e)) {
      if (!warnedMissing) { console.warn(`[accessorialApprovals] ${TABLE} not found — apply migration 051. Falling back to shipments.accessorials.`); warnedMissing = true; }
      return [];
    }
    throw e;
  }
}

function validate(input) {
  const type = String(input.accessorialType || '').toLowerCase().trim();
  if (!TYPES.includes(type)) throw bad(`accessorialType must be one of ${TYPES.join(', ')}`);
  const maxHours = input.maxHours != null && input.maxHours !== '' ? Number(input.maxHours) : null;
  const ratePerHour = input.ratePerHour != null && input.ratePerHour !== '' ? Number(input.ratePerHour) : null;
  const maxAmount = input.maxAmount != null && input.maxAmount !== '' ? Number(input.maxAmount) : null;
  const hourly = maxHours > 0 && ratePerHour > 0;
  const flat = maxAmount > 0;
  if (!hourly && !flat) throw bad('Give either maxHours + ratePerHour, or maxAmount (all > 0)');
  return { accessorial_type: type, max_hours: hourly ? maxHours : null, rate_per_hour: hourly ? ratePerHour : null, max_amount: hourly ? null : maxAmount };
}

async function create({ shipmentId, input, user, tenantId = null }) {
  if (!shipmentId) throw bad('shipmentId is required');
  const ship = await db.dbSelect('shipments', { select: 'id', filters: [['id', 'eq', shipmentId]], limit: 1 });
  if (!ship.length) throw bad(`Shipment not found: ${shipmentId}`, 404);
  const nowIso = new Date().toISOString();
  const row = {
    shipment_id: shipmentId,
    ...validate(input || {}),
    notes: (input && input.notes) || null,
    approved_by: (user && user.email) || 'system',
    approved_at: nowIso,
    tenant_id: tenantId || null,
    created_at: nowIso,
    updated_at: nowIso,
  };
  const { data, error } = await db.getClient().from(TABLE).insert(row).select().single();
  if (error) throw new Error(`[DB] ${TABLE} insert failed: ${error.message}`);
  await history.recordChange({
    entityType: 'shipment', entityId: shipmentId, action: 'edit', field: 'accessorial_approval',
    before: null, after: `${row.accessorial_type} ${basisText(row)}`, user, metadata: { approvalId: data.id },
  }).catch(() => {});
  return data;
}

async function remove({ shipmentId, approvalId, user }) {
  const rows = await db.dbSelect(TABLE, { filters: [['id', 'eq', approvalId], ['shipment_id', 'eq', shipmentId]], limit: 1 });
  if (!rows.length) throw bad('Approval not found', 404);
  const { error } = await db.getClient().from(TABLE).delete().eq('id', approvalId);
  if (error) throw new Error(`[DB] ${TABLE} delete failed: ${error.message}`);
  await history.recordChange({
    entityType: 'shipment', entityId: shipmentId, action: 'edit', field: 'accessorial_approval',
    before: `${rows[0].accessorial_type} ${basisText(rows[0])}`, after: null, user, metadata: { approvalId, removed: true },
  }).catch(() => {});
  return { removedId: approvalId };
}

module.exports = { TYPES, listForShipments, create, remove, approvedAmount, basisText };
