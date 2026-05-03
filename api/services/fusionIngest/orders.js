// ═══════════════════════════════════════════════════════════════════
// Fusion Orders Ingest Service — F1 (Fusion SO / Shipment Request → TMS).
//
// Mirrors the pattern of api/services/orderIngest.js (REQ-01 OMS path):
//   1. Validate the payload shape (header + lines).
//   2. Map Fusion-shaped fields → TMS orders schema columns. Stamp
//      sync_source = 'fusion', auto_synced_at = NOW(), and the
//      external-key columns (fusion_so_header_id, etc).
//   3. Upsert the orders row idempotently.
//   4. Replace the order_lines rows for this order id (same pattern
//      orderIngest.js uses for OMS lines).
//   5. Write a change_history row with metadata.via = 'fusion-oic'
//      so the History tab attributes the change.
//   6. Emit ORDER_CREATED on the in-process bus → SSE → TMS UI lights up.
//   7. Return summary { acceptedIds, skipped }.
//
// Tenancy: this repo selects the Supabase project per tenant via
// tenantConfig at the route/service boundary (see api/services/supabase.js).
// We do NOT carry a row-level tenant_id; tenant_id in the payload is an
// optional audit tag only.
//
// All side-effects are best-effort except the orders upsert: history
// or SSE failures must NOT roll back the main DB write (matches the
// existing service convention).
// ═══════════════════════════════════════════════════════════════════

const db        = require('../supabase');
const history   = require('../changeHistory');
const { bus, EVENTS } = require('../eventBus');
const { buildOrderLineId } = require('../orderLineIds');

// Fusion → TMS status enum.
const STATUS_MAP = {
  'Entered':           'Unplanned',
  'Submitted':         'Unplanned',
  'Awaiting Shipping': 'Unplanned',
  'Pick Released':     'Unplanned',
  'Shipped':           'Shipped',
  'Closed':            'Delivered',
  'Canceled':          'Cancelled',
  'Cancelled':         'Cancelled',
};

function validate(body) {
  const errs = [];
  if (!body || typeof body !== 'object') return ['payload must be an object'];
  if (!body.fusion_so_header_id) errs.push('fusion_so_header_id is required');
  // tenant_id is optional in the payload — see header comment above.
  if (!body.header || typeof body.header !== 'object') {
    errs.push('header is required');
    return errs;
  }
  const h = body.header;
  if (!h.customer)                 errs.push('header.customer is required');
  if (!h.origin)                   errs.push('header.origin is required');
  if (!(h.dest || h.destination))  errs.push('header.dest is required');
  if (Array.isArray(body.lines)) {
    body.lines.forEach((l, i) => {
      if (!Number.isFinite(Number(l.qty_ordered)) || Number(l.qty_ordered) <= 0) {
        errs.push(`lines[${i}].qty_ordered must be > 0`);
      }
    });
  }
  return errs;
}

function mapHeaderToRow(body) {
  const h = body.header || {};
  const id = h.id || `FUS-${body.fusion_so_header_id}`;
  const status = STATUS_MAP[h.status] || h.status || 'Unplanned';

  const row = {
    id,
    customer:     h.customer,
    origin:       h.origin,
    dest:         h.dest || h.destination,
    origin_zip:   h.origin_zip || null,
    dest_zip:     h.dest_zip   || null,
    status,
    hazmat:       !!h.hazmat,
    sync_source:    'fusion',
    auto_synced_at: new Date().toISOString(),
    fusion_so_header_id:        body.fusion_so_header_id,
    fusion_shipment_request_id: body.fusion_shipment_request_id || null,
    fusion_business_unit_id:    body.fusion_business_unit_id    || null,
  };

  const setIf = (k, v) => { if (v !== undefined && v !== null && v !== '') row[k] = v; };
  setIf('po_number',         h.po_number);
  setIf('ready',             h.ready);
  setIf('due',               h.due);
  setIf('preferred_carrier', h.preferred_carrier);
  setIf('service_level',     h.service_level);
  setIf('incoterms',         h.incoterms);
  setIf('ship_to_name',      h.ship_to_name);
  setIf('ship_from_name',    h.ship_from_name);
  setIf('ship_to_address',   h.ship_to_address);
  setIf('notes',             h.notes);

  if (Number.isFinite(Number(h.weight))) row.weight = Number(h.weight);
  if (Number.isFinite(Number(h.pieces))) row.pieces = Number(h.pieces);

  return row;
}

function mapLineToRow(orderId, line, idx) {
  const lineNum = line.line_num || (idx + 1);
  const qty     = Number(line.qty_ordered) || 0;
  const unitWt  = Number(line.unit_weight) || 0;
  const unitVal = Number(line.unit_value)  || 0;
  return {
    id:           buildOrderLineId(orderId, lineNum),
    order_id:     orderId,
    line_num:     lineNum,
    item_id:      line.item_id || null,
    description:  line.description || line.item_id || '',
    qty_ordered:  qty,
    unit_weight:  unitWt,
    total_weight: Number(line.total_weight) || (qty * unitWt),
    unit_value:   unitVal,
    total_value:  Number(line.total_value)  || (qty * unitVal),
  };
}

async function replaceLines(orderId, rawLines, tenantConfig) {
  const lines = (rawLines || []).map((l, i) => mapLineToRow(orderId, l, i));
  const client = db.getClient(tenantConfig);
  const { error: delErr } = await client.from('order_lines').delete().eq('order_id', orderId);
  if (delErr) throw new Error(`[DB] order_lines delete failed: ${delErr.message}`);
  if (!lines.length) return { count: 0, totalWeight: 0, totalPieces: 0 };
  const { error: insErr } = await client.from('order_lines').insert(lines);
  if (insErr) throw new Error(`[DB] order_lines insert failed: ${insErr.message}`);
  const totalWeight = lines.reduce((s, l) => s + (l.total_weight || 0), 0);
  const totalPieces = lines.reduce((s, l) => s + (l.qty_ordered  || 0), 0);
  return { count: lines.length, totalWeight, totalPieces };
}

async function ingestSalesOrder(body, tenantConfig = null) {
  const errs = validate(body);
  if (errs.length) {
    const e = new Error(`Validation failed: ${errs.join('; ')}`);
    e.status = 400;
    e.details = errs;
    throw e;
  }

  const existing = await db.dbSelect('orders', {
    filters: [['fusion_so_header_id', 'eq', body.fusion_so_header_id]],
    limit: 1,
    select: 'id,status,fusion_so_header_id',
  }, tenantConfig);

  const row = mapHeaderToRow(body);
  const isUpdate = Array.isArray(existing) && existing.length > 0;
  const before   = isUpdate ? existing[0] : null;

  const saved = await db.dbUpsert('orders', row, 'id', tenantConfig);

  let lineSummary = null;
  if (Array.isArray(body.lines) && body.lines.length) {
    try {
      lineSummary = await replaceLines(saved.id, body.lines, tenantConfig);
      await db.dbUpdate('orders', saved.id, {
        line_count: lineSummary.count,
        weight:     lineSummary.totalWeight,
        pieces:     lineSummary.totalPieces,
      }, tenantConfig);
      saved.line_count = lineSummary.count;
      saved.weight     = lineSummary.totalWeight;
      saved.pieces     = lineSummary.totalPieces;
    } catch (lineErr) {
      console.error('[fusionIngest.orders] line upsert failed for', saved.id, lineErr.message);
    }
  }

  try {
    await history.recordChange({
      entityType: 'order',
      entityId:   saved.id,
      action:     isUpdate ? 'edit' : 'create',
      field:      isUpdate ? 'status' : null,
      before:     before ? before.status : null,
      after:      saved.status,
      user:       { email: 'fusion-oic' },
      metadata:   {
        via: 'fusion-oic',
        fusion_so_header_id: body.fusion_so_header_id,
        fusion_shipment_request_id: body.fusion_shipment_request_id || null,
      },
    });
  } catch (auditErr) {
    console.error('[fusionIngest.orders] history write failed:', auditErr.message);
  }

  bus.emit(isUpdate ? EVENTS.ORDER_UPDATED : EVENTS.ORDER_CREATED, {
    id:                  saved.id,
    customer:            saved.customer,
    origin:              saved.origin,
    dest:                saved.dest,
    weight:              saved.weight,
    sync_source:         'fusion',
    auto_synced_at:      saved.auto_synced_at,
    fusion_so_header_id: saved.fusion_so_header_id,
    line_count:          lineSummary ? lineSummary.count : null,
  });

  return {
    id: saved.id,
    fusion_so_header_id: saved.fusion_so_header_id,
    isUpdate,
    lineCount: lineSummary ? lineSummary.count : 0,
  };
}

module.exports = { ingestSalesOrder, validate, mapHeaderToRow, STATUS_MAP };
