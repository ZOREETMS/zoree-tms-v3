// ═══════════════════════════════════════════════════════════════════
// Invoice Cost Lines Service — REQ-186.
//
// Each invoice has a per-cost-line breakdown:
//   { cost_type, description, invoice_cost, approved_cost, line_order }
//
// `invoice_cost`  = what the carrier billed (or, for a TMS-initiated
//                   invoice, what was copied off the shipment).
// `approved_cost` = what finance has approved. Defaults to invoice_cost,
//                   editable until the invoice is sent to AP.
//
// This module is the SINGLE WRITER of `invoice_cost_lines`. Every write
// also emits a REQ-02 change_history row on the parent invoice so the
// History drawer surfaces approved-cost adjustments.
//
// The translation layer (shipment row → cost-line array) is exposed as
// a pure function `costLinesFromShipment` so it's unit-testable and so
// `invoiceFromShipment.js` can call it without going through the DB.
// ═══════════════════════════════════════════════════════════════════

const db = require('./supabase');
const history = require('./changeHistory');

const TABLE = 'invoice_cost_lines';

const VALID_COST_TYPES = Object.freeze([
  'base', 'fuel_surcharge', 'accessorial', 'discount', 'other',
]);

const COST_TYPE_LABELS = Object.freeze({
  base:           'Base Rate',
  fuel_surcharge: 'Fuel Surcharge',
  accessorial:    'Accessorial',
  discount:       'Discount',
  other:          'Other',
});

function num(v, fallback = 0) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

// ── Pure: shipment row → cost-line array ─────────────────────────
// Drops zero-value lines so a quote that has no fuel surcharge doesn't
// render a $0.00 row, but ALWAYS emits a base line (even if 0) so the
// invoice always has at least one row to edit.
//
// Discount is represented as a negative invoice_cost on its own line —
// the same way the shipment row stores it (`shipments.discount`).
//
// `extraAccessorials` is reserved for future per-charge breakdowns; the
// current shipment schema only has the rolled-up `accessorials` scalar.
function costLinesFromShipment(shipment) {
  if (!shipment || typeof shipment !== 'object') return [];
  const rate          = num(shipment.rate, 0);
  const fuelSurcharge = num(shipment.fuel_surcharge, 0);
  const accessorials  = num(shipment.accessorials, 0);
  const discount      = num(shipment.discount, 0);

  const lines = [];
  // Always emit base — even if 0 — so finance sees the line and can edit.
  lines.push({
    cost_type:     'base',
    description:   `Base rate for ${shipment.id || 'shipment'}`,
    invoice_cost:  round2(rate),
    approved_cost: round2(rate),
    line_order:    10,
  });
  if (fuelSurcharge > 0) {
    lines.push({
      cost_type:     'fuel_surcharge',
      description:   'Fuel surcharge',
      invoice_cost:  round2(fuelSurcharge),
      approved_cost: round2(fuelSurcharge),
      line_order:    20,
    });
  }
  if (accessorials > 0) {
    lines.push({
      cost_type:     'accessorial',
      description:   'Accessorials (rolled up)',
      invoice_cost:  round2(accessorials),
      approved_cost: round2(accessorials),
      line_order:    30,
    });
  }
  if (discount && discount !== 0) {
    // Discounts billed on the shipment are stored as positive numbers
    // there; we convert to a negative cost-line so the sum still gives
    // the correct total.
    const signed = discount > 0 ? -round2(discount) : round2(discount);
    lines.push({
      cost_type:     'discount',
      description:   'Discount',
      invoice_cost:  signed,
      approved_cost: signed,
      line_order:    40,
    });
  }
  return lines;
}

function sumApproved(lines) {
  if (!Array.isArray(lines)) return 0;
  return round2(lines.reduce((s, l) => s + num(l.approved_cost, 0), 0));
}

function sumInvoiced(lines) {
  if (!Array.isArray(lines)) return 0;
  return round2(lines.reduce((s, l) => s + num(l.invoice_cost, 0), 0));
}

function ensureCostType(t) {
  if (!VALID_COST_TYPES.includes(t)) {
    const e = new Error(`Invalid cost_type '${t}'. Allowed: ${VALID_COST_TYPES.join(', ')}`);
    e.status = 400;
    throw e;
  }
}

// ── DB writes ───────────────────────────────────────────────────
// `replaceForInvoice` is intended for the create path (just after the
// invoice row is inserted). It nukes any existing lines for that
// invoice id and inserts the new set in a single batch — safe because
// the invoice was created in the same transaction-like sequence and
// the FK has ON DELETE CASCADE so a partial-failure during the very
// first insert leaves the invoice with zero lines, never with a
// half-populated mix from two builds.
async function replaceForInvoice({ invoiceId, lines, tenantId = null }) {
  if (!invoiceId) {
    const e = new Error('invoiceId is required'); e.status = 400; throw e;
  }
  const client = db.getClient();
  // Wipe existing lines (idempotent re-builds — e.g. after a carrier
  // resubmission attached to the same invoice id).
  {
    const { error } = await client.from(TABLE).delete().eq('invoice_id', invoiceId);
    if (error) throw new Error(`[DB] ${TABLE} delete failed: ${error.message}`);
  }
  const safeLines = (Array.isArray(lines) ? lines : []).map((l, i) => {
    ensureCostType(l.cost_type);
    return {
      invoice_id:    invoiceId,
      cost_type:     l.cost_type,
      description:   l.description ?? null,
      invoice_cost:  num(l.invoice_cost, 0),
      approved_cost: num(l.approved_cost, num(l.invoice_cost, 0)),
      line_order:    Number.isInteger(l.line_order) ? l.line_order : (i + 1) * 10,
      tenant_id:     tenantId || l.tenant_id || null,
    };
  });
  if (!safeLines.length) return [];
  const { data, error } = await client.from(TABLE).insert(safeLines).select();
  if (error) throw new Error(`[DB] ${TABLE} insert failed: ${error.message}`);
  return data || [];
}

async function listForInvoice(invoiceId) {
  if (!invoiceId) {
    const e = new Error('invoiceId is required'); e.status = 400; throw e;
  }
  return db.dbSelect(TABLE, {
    filters: [['invoice_id', 'eq', invoiceId]],
    order: { col: 'line_order', asc: true },
  });
}

// Patch a single line — only `description`, `invoice_cost`, and
// `approved_cost` are editable. cost_type/line_order are immutable to
// keep the audit trail meaningful (you cannot retroactively reclassify
// a charge — add a new line instead).
const EDITABLE = new Set(['description', 'invoice_cost', 'approved_cost']);

async function updateLine({ invoiceId, lineId, patch, user }) {
  if (!invoiceId) { const e = new Error('invoiceId is required'); e.status = 400; throw e; }
  if (!lineId)    { const e = new Error('lineId is required');    e.status = 400; throw e; }
  const cleaned = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (!EDITABLE.has(k)) continue;
    cleaned[k] = (k === 'description') ? (v == null ? null : String(v))
                                       : num(v, null);
  }
  if (!Object.keys(cleaned).length) {
    const e = new Error('No editable fields provided'); e.status = 400; throw e;
  }
  if ('invoice_cost'  in cleaned && cleaned.invoice_cost  !== null && cleaned.invoice_cost  < 0) {
    const e = new Error('invoice_cost must be >= 0'); e.status = 400; throw e;
  }
  if ('approved_cost' in cleaned && cleaned.approved_cost !== null && cleaned.approved_cost < 0) {
    const e = new Error('approved_cost must be >= 0'); e.status = 400; throw e;
  }
  cleaned.updated_at = new Date().toISOString();

  // Read the current row (for audit diff) — we filter by both line id
  // and invoice id so a request can't update another invoice's line.
  const before = await db.dbSelect(TABLE, {
    filters: [['id', 'eq', lineId], ['invoice_id', 'eq', invoiceId]],
    limit: 1,
  });
  const beforeRow = Array.isArray(before) && before.length ? before[0] : null;
  if (!beforeRow) {
    const e = new Error(`Cost line not found: ${lineId}`); e.status = 404; throw e;
  }

  const client = db.getClient();
  const { data, error } = await client.from(TABLE)
    .update(cleaned).eq('id', lineId).eq('invoice_id', invoiceId).select();
  if (error) throw new Error(`[DB] ${TABLE} update failed: ${error.message}`);
  const updated = data?.[0] || null;
  if (!updated) {
    const e = new Error(`Cost line not found after update: ${lineId}`); e.status = 404; throw e;
  }

  // REQ-02: write a field-diff row on the parent invoice. Field name
  // includes the cost_type so the History drawer renders e.g.
  //   "cost_line.fuel_surcharge.approved_cost: $120.00 → $95.00".
  try {
    await history.recordFieldDiffs({
      entityType: 'invoice',
      entityId:   invoiceId,
      before:     beforeRow,
      after:      updated,
      user,
      fields: {
        invoice_cost:  `cost_line.${updated.cost_type}.invoice_cost`,
        approved_cost: `cost_line.${updated.cost_type}.approved_cost`,
        description:   `cost_line.${updated.cost_type}.description`,
      },
      metadata: { lineId, costType: updated.cost_type, via: 'cost-line-edit' },
    });
  } catch (auditErr) {
    console.error('[invoiceCostLines.updateLine] history write failed:', auditErr.message);
  }

  return updated;
}

module.exports = {
  VALID_COST_TYPES,
  COST_TYPE_LABELS,
  costLinesFromShipment,
  sumApproved,
  sumInvoiced,
  replaceForInvoice,
  listForInvoice,
  updateLine,
  // Exposed for unit tests
  _internals: { num, round2 },
};
