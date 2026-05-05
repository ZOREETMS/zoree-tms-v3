// ═══════════════════════════════════════════════════════════════════
// Order Ingest Service — REQ-01 Auto order sync OMS → TMS.
// (Mount-resync write — full content matches the Windows-host file.)
// ═══════════════════════════════════════════════════════════════════

const db = require('./supabase');
const { bus, EVENTS } = require('./eventBus');
const { buildOrderLineId } = require('./orderLineIds');
// TMS bugs #33 + #66: every OMS-side priority/service-level label is
// run through the shared vocabulary normalizer so the TMS row uses the
// canonical Service Level dropdown value the planner UI expects.
const { normalizeServiceLevel } = require('./serviceLevelVocab');

function normalizeOmsLine(orderId, line, idx) {
  const lineNum = line.line_num || line.lineNum || (idx + 1);
  const qty = Number(line.qty_ordered ?? line.qty) || 0;
  const unitWt = Number(line.unit_weight ?? line.unitWt ?? line.wt) || 0;
  const unitVal = Number(line.unit_value ?? line.unitValue ?? line.val) || 0;
  return {
    id:           buildOrderLineId(orderId, lineNum),
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
  const { error: delErr } = await client.from('order_lines').delete().eq('order_id', orderId);
  if (delErr) throw new Error(`[DB] order_lines delete failed: ${delErr.message}`);
  if (normalized.length === 0) return { count: 0, totalWeight: 0, totalPieces: 0 };
  const { error: insErr } = await client.from('order_lines').insert(normalized);
  if (insErr) throw new Error(`[DB] order_lines insert failed: ${insErr.message}`);
  const totalWeight = normalized.reduce((s, l) => s + (l.total_weight || 0), 0);
  const totalPieces = normalized.reduce((s, l) => s + (l.qty_ordered || 0), 0);
  return { count: normalized.length, totalWeight, totalPieces };
}

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

function omsPayloadToDbRow(o) {
  const id = o.id || ('ORD-' + Math.floor(100000 + Math.random() * 900000));
  const row = {
    id,
    weight:         Number(o.weight) || 0,
    pieces:         Number(o.pieces) || 0,
    status:         o.status || 'Unplanned',
    hazmat:         !!o.hazmat,
    no_contract_rate: !!(o.noContractRate || o.no_contract_rate),
    no_consolidate:   !!(o.noConsolidate || o.no_consolidate),
    dedicated_equip:  !!(o.dedicatedEquip || o.dedicated_equip),
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
  // TMS bugs #33 + #66: accept OMS legacy `priority` and normalise.
  setIf(
    'service_level',
    normalizeServiceLevel(o.serviceLevel || o.service_level || o.priority || o.Priority),
  );
  setIf('commodity',         o.commodity);
  setIf('incoterms',         o.incoterms);
  setIf('po_number',         o.poNumber || o.po_number || o.poNum || o.po_num);
  setIf('ready',             o.readyDate || o.ready);
  setIf('due',               o.dueDate   || o.due);
  setIf('preferred_carrier', o.preferredCarrier || o.preferred_carrier);
  setIf('excluded_carrier',  o.excludedCarrier || o.excluded_carrier);
  setIf('notes',             o.notes);
  setIf('oms_order_ref',     o.omsOrderRef || o.oms_order_ref || o.id);
  setIf('ship_to_name',      o.shipToName || o.ship_to_name);
  setIf('ship_from_name',    o.shipFromName || o.ship_from_name);
  setIf('ship_to_address',   o.shipToAddress || o.ship_to_address || o.dest || o.destination);

  return row;
}

async function ingestOmsBatch(batch, tenantConfig = null) {
  if (!batch || !Array.isArray(batch.orders)) {
    const err = new Error('Payload must be { orders: [...] }');
    err.status = 400;
    throw err;
  }

  const allErrors = [];
  batch.orders.forEach((o, i) => { allErrors.push(...validateOmsOrder(o, i)); });
  if (allErrors.length) {
    const err = new Error('Validation failed: ' + allErrors.join('; '));
    err.status = 400; err.details = allErrors;
    throw err;
  }

  const results = [];
  for (const o of batch.orders) {
    const row = omsPayloadToDbRow(o);
    const saved = await db.dbUpsert('orders', row, 'id', tenantConfig);

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
