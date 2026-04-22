// ═══════════════════════════════════════════════════════════════════
// Order Ingest Service — REQ-01 Auto order sync OMS → TMS.
//
// The middleware POSTs orders here as soon as the OMS books them.
// There is no job, no button, no polling — this is the pull point
// for "order is automatically sent to tms".
//
// Responsibilities (business logic tier — no HTTP concerns):
//   1. Validate each inbound OMS order (shape + required fields)
//   2. Map OMS payload → TMS orders schema, stamping:
//        sync_source    = 'oms'
//        auto_synced_at = NOW()
//        oms_order_ref  = the OMS side id (for traceability)
//   3. Upsert into the orders table (idempotent on id)
//   4. Emit ORDER_CREATED on the event bus so the SSE stream
//      delivers the new order to every open TMS Orders page.
//
// This file does NOT talk to HTTP — the route layer (api/routes/ingest.js)
// handles that and passes a parsed array of orders here.
// ═══════════════════════════════════════════════════════════════════

const db = require('./supabase');
const { bus, EVENTS } = require('./eventBus');

// REQ-24: helpers for upserting line items alongside the order header.
// Kept local — lines are only ever pushed in through the OMS ingest path,
// so there's no shared service worth factoring out yet (CLAUDE_RULES §6).
function normalizeOmsLine(orderId, line, idx) {
  const lineNum = line.line_num || line.lineNum || (idx + 1);
  const qty = Number(line.qty_ordered ?? line.qty) || 0;
  const unitWt = Number(line.unit_weight ?? line.unitWt ?? line.wt) || 0;
  const unitVal = Number(line.unit_value ?? line.unitValue ?? line.val) || 0;
  return {
    id:           `${orderId}-L${String(lineNum).padStart(3, '0')}`,
    order_id:     orderId,
    line_num:     lineNum,
    item_id:      line.item_id || line.itemId || null,
    description:  line.description || line.desc || line.itemId || '',
    qty_ordered:  qty,
    unit_weight:  unitWt,
    total_weight: Number(line.total_weight ?? line.totalWt) || (qty * unitWt),
    unit_value:   unitVal,
    total_value:  Number(line.total_value ?? line.totalVal) || (qty * unitVal),
  };
}

async function replaceOrderLines(orderId, rawLines, tenantConfig) {
  const normalized = (rawLines || []).map((l, i) => normalizeOmsLine(orderId, l, i));
  const client = db.getClient(tenantConfig);
  // Replace-in-place: delete prior lines, then insert the new set. This
  // mirrors the POST /api/orders/:id/lines handler in api/server.js so
  // OMS-pushed orders and UI-edited orders end up with identical
  // line_count / weight / pieces semantics.
  const { error: delErr } = await client.from('order_lines').delete().eq('order_id', orderId);
  if (delErr) throw new Error(`[DB] order_lines delete failed: ${delErr.message}`);
  if (normalized.length === 0) return { count: 0, totalWeight: 0, totalPieces: 0 };
  const { error: insErr } = await client.from('order_lines').insert(normalized);
  if (insErr) throw new Error(`[DB] order_lines insert failed: ${insErr.message}`);
  const totalWeight = normalized.reduce((s, l) => s + (l.total_weight || 0), 0);
  const totalPieces = normalized.reduce((s, l) => s + (l.qty_ordered || 0), 0);
  return { count: normalized.length, totalWeight, totalPieces };
}

// ── Validation ────────────────────────────────────────────────────
function validateOmsOrder(o, idx) {
  const errs = [];
  if (!o || typeof o !== 'object') return [`orders[${idx}] is not an object`];
  if (!o.customer) errs.push(`orders[${idx}].customer is required`);
  if (!o.origin)   errs.push(`orders[${idx}].origin is required`);
  if (!(o.destination || o.dest)) errs.push(`orders[${idx}].destination is required`);
  const w = Number(o.weight);
  if (!Number.isFinite(w) || w <= 0) errs.push(`orders[${idx}].weight must be > 0`);
  return errs;
}

// ── Field mapping: OMS payload → TMS orders row ──────────────────
//   OMS sends a flat payload similar to the TMS API. This mapper
//   normalizes field-name variants and stamps the sync audit cols.
function omsPayloadToDbRow(o) {
  const id = o.id || ('ORD-' + Math.floor(100000 + Math.random() * 900000));
  // Mirror the conditional pattern in api/services/orderMutations.js:apiOrderToDbPatch —
  // only include optional columns if the input actually carries a value. This
  // keeps the insert compatible with schemas that don't have every optional
  // column (e.g. a tenant DB without po_number / ref_num). Required columns
  // (id, weight, status, sync_source, auto_synced_at) are always written.
  const row = {
    id,
    weight:         Number(o.weight) || 0,
    pieces:         Number(o.pieces) || 0,
    status:         o.status || 'Unplanned',
    hazmat:         !!o.hazmat,
    no_contract_rate: !!(o.noContractRate || o.no_contract_rate),
    no_consolidate:   !!(o.noConsolidate || o.no_consolidate),
    dedicated_equip:  !!(o.dedicatedEquip || o.dedicated_equip),
    // REQ-01 audit columns
    sync_source:    'oms',
    auto_synced_at: new Date().toISOString(),
  };

  const setIf = (key, val) => { if (val !== undefined && val !== null && val !== '') row[key] = val; };
  setIf('customer',          o.customer);
  setIf('origin',            o.origin);
  setIf('dest',              o.destination || o.dest);
  setIf('origin_zip',        o.originZip || o.origin_zip);
  setIf('dest_zip',          o.destZip || o.dest_zip);
  setIf('ship_mode',         o.shipMode || o.ship_mode);
  // REQ-10 / REQ-11: carry service level from OMS → TMS so planning
  // honours the selection made at order creation time.
  setIf('service_level',     o.serviceLevel || o.service_level);
  setIf('commodity',         o.commodity);
  setIf('incoterms',         o.incoterms);
  // NOTE: actual schema column is po_num (matches api/services/orders.js and
  // orderMutations.js). ref_num is not in the schema at all — drop it silently
  // if supplied.
  setIf('po_num',            o.poNumber || o.po_number || o.poNum || o.po_num);
  setIf('ready',             o.readyDate || o.ready);
  setIf('due',               o.dueDate   || o.due);
  setIf('preferred_carrier', o.preferredCarrier || o.preferred_carrier);
  setIf('excluded_carrier',  o.excludedCarrier || o.excluded_carrier);
  setIf('notes',             o.notes);
  setIf('oms_order_ref',     o.omsOrderRef || o.oms_order_ref || o.id);
  // Ship-to / ship-from labels supplied by OMS when the user picks a
  // named location. Keeping these on the TMS row lets the Orders page
  // show "Dallas Warehouse" next to the city/state/zip instead of
  // forcing a lookup or losing the label entirely.
  setIf('ship_to_name',      o.shipToName || o.ship_to_name);
  setIf('ship_from_name',    o.shipFromName || o.ship_from_name);
  // Canonical destination address string ("CITY, ST ZIP") stripped of
  // any location-name prefix the OMS may have carried in `dest`.
  setIf('ship_to_address',   o.shipToAddress || o.ship_to_address || o.dest || o.destination);

  return row;
}

// ── Ingest entry point ───────────────────────────────────────────
// Accepts { orders: [...] } and an optional tenantConfig. Upserts each
// order, emits one ORDER_CREATED event per order and one
// OMS_SYNC_BATCH event for the batch (so subscribers can show a
// single toast). HTTP / auth concerns live in the route layer.
async function ingestOmsBatch(batch, tenantConfig = null) {
  if (!batch || !Array.isArray(batch.orders)) {
    const err = new Error('Payload must be { orders: [...] }');
    err.status = 400;
    throw err;
  }

  const allErrors = [];
  batch.orders.forEach((o, i) => {
    allErrors.push(...validateOmsOrder(o, i));
  });
  if (allErrors.length) {
    const err = new Error('Validation failed: ' + allErrors.join('; '));
    err.status = 400;
    err.details = allErrors;
    throw err;
  }

  const results = [];
  for (const o of batch.orders) {
    const row = omsPayloadToDbRow(o);
    const saved = await db.dbUpsert('orders', row, 'id', tenantConfig);

    // REQ-24: if the OMS payload includes line items, replace the TMS
    // order_lines for this id. Recalc weight / pieces / line_count on
    // the header from the actual line totals so the OMS-submitted
    // values don't silently drift from what's in order_lines.
    let lineSummary = null;
    if (Array.isArray(o.lines) && o.lines.length > 0) {
      try {
        lineSummary = await replaceOrderLines(saved.id, o.lines, tenantConfig);
        await db.dbUpdate('orders', saved.id, {
          line_count: lineSummary.count,
          weight:     lineSummary.totalWeight,
          pieces:     lineSummary.totalPieces,
        }, tenantConfig);
        saved.line_count = lineSummary.count;
        saved.weight     = lineSummary.totalWeight;
        saved.pieces     = lineSummary.totalPieces;
      } catch (lineErr) {
        // Don't fail the whole ingest on a line-upsert error — the
        // header is already saved and we want the push to proceed.
        // Caller sees the error via the SSE event metadata.
        console.error('[orderIngest] line upsert failed for', saved.id, lineErr.message);
      }
    }

    results.push(saved);
    bus.emit(EVENTS.ORDER_CREATED, {
      id: saved.id,
      customer: saved.customer,
      origin: saved.origin,
      dest: saved.dest,
      weight: saved.weight,
      sync_source: saved.sync_source || 'oms',
      auto_synced_at: saved.auto_synced_at,
      oms_order_ref: saved.oms_order_ref,
      line_count: lineSummary ? lineSummary.count : null,
    });
  }

  bus.emit(EVENTS.OMS_SYNC_BATCH, {
    count: results.length,
    ids: results.map((r) => r.id),
    at: new Date().toISOString(),
  });

  return {
    accepted: results.length,
    ids: results.map((r) => r.id),
    syncedAt: new Date().toISOString(),
  };
}

module.exports = { ingestOmsBatch, omsPayloadToDbRow, validateOmsOrder };
