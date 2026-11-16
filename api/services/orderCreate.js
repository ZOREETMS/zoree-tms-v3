// ═══════════════════════════════════════════════════════════════════
// Order create service — one server-side path for creating an order
// with its lines, for back-office agents (email intake today).
//
// Writes through the same mapper as POST /api/orders
// (orderMutations.apiOrderToDbPatch), records the REQ-02 'create'
// change_history row, and emits ORDER_CREATED so the Orders page
// refreshes over SSE/WS. Lines go through orderLines.buildLines, the
// same normalizer the bulk-plan import uses.
//
// Differences from the inline POST /api/orders route, on purpose:
//   • INSERT, not upsert — an agent must never overwrite an existing
//     order because an id collided. A collision retries with a new id.
//   • Lines are written in the same call, and a line failure rolls the
//     order back (DB rules: no partial writes for multi-step operations).
// ═══════════════════════════════════════════════════════════════════

'use strict';

const db = require('./supabase');
const history = require('./changeHistory');
const { bus, EVENTS } = require('./eventBus');
const { apiOrderToDbPatch } = require('./orderMutations');
const { buildLines } = require('./orderLines');

const VALID_SYNC_SOURCES = new Set(['manual', 'oms', 'api', 'import', 'fusion', 'email']);

function newOrderId() {
  return `ORD-${Math.floor(100000 + Math.random() * 900000)}`;
}

/** Fields an order needs before the planner can rate it. Mirrors orderIngest.validateOmsOrder. */
function validateOrderBody(b) {
  const errs = [];
  if (!b || typeof b !== 'object') return ['order is not an object'];
  if (!String(b.customer || '').trim()) errs.push('customer');
  if (!String(b.origin || '').trim()) errs.push('origin');
  if (!String(b.destination || b.dest || '').trim()) errs.push('destination');
  const w = Number(b.weight);
  if (!Number.isFinite(w) || w <= 0) errs.push('weight');
  return errs;
}

async function insertOrderRow(row, tenantConfig) {
  const client = db.getClient(tenantConfig);
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = { ...row, id: row.id || newOrderId() };
    const { data, error } = await client.from('orders').insert(candidate).select();
    if (!error) return data && data[0];
    // 23505 = unique_violation on the primary key → pick a new id and retry.
    if (error.code === '23505' && !row.id) continue;
    throw new Error(`[DB] orders insert failed: ${error.message}`);
  }
  throw new Error('[DB] orders insert failed: could not allocate a unique order id');
}

/**
 * Create one order (+ lines).
 * @param {object}   args
 * @param {object}   args.body        API-shaped order (customer, origin, destination, weight, …)
 * @param {object[]} [args.lines]     [{ description, qty, unitWeight, totalWeight, itemId }]
 * @param {object}   args.user        actor for change_history (user object or { email })
 * @param {string}   args.syncSource  orders.sync_source value
 * @param {object}   [args.extra]     extra DB columns (e.g. { email_intake_id })
 * @returns {Promise<object>} the saved DB row
 */
async function createOrder({ body, lines = [], user, syncSource = 'manual', extra = {}, tenantConfig = null }) {
  if (!VALID_SYNC_SOURCES.has(syncSource)) throw new Error(`Invalid sync_source '${syncSource}'`);
  const missing = validateOrderBody(body);
  if (missing.length) {
    const err = new Error(`Order is missing required fields: ${missing.join(', ')}`);
    err.status = 400; err.missing = missing;
    throw err;
  }

  const patch = apiOrderToDbPatch(body);
  const row = {
    ...patch,
    status: patch.status || 'Unplanned',
    sync_source: syncSource,
    auto_synced_at: new Date().toISOString(),
    ...extra,
  };
  if (body.id) row.id = body.id;

  const saved = await insertOrderRow(row, tenantConfig);
  if (!saved || !saved.id) throw new Error('Order insert returned no row');

  // Lines + rollup. Roll the order back if they fail so a half-built
  // order never shows up on the planner's board.
  let lineSummary = null;
  const built = buildLines(saved.id, lines);
  if (built.lines.length) {
    const client = db.getClient(tenantConfig);
    const { error: lineErr } = await client.from('order_lines').insert(built.lines);
    if (lineErr) {
      await client.from('orders').delete().eq('id', saved.id);
      throw new Error(`[DB] order_lines insert failed, order rolled back: ${lineErr.message}`);
    }
    const rollup = { line_count: built.lines.length };
    // The header is what the customer declared for the whole shipment, so
    // it wins: gross weight includes pallets/packaging that line items
    // often leave out (rating needs gross), and summing line quantities
    // would turn "20 switches on 4 pallets" into 24 pieces. Line totals
    // only fill a header value that is missing.
    if (!(Number(row.weight) > 0) && built.weight > 0) rollup.weight = built.weight;
    if (!(Number(row.pieces) > 0) && built.pieces > 0) rollup.pieces = built.pieces;
    const updated = await db.dbUpdate('orders', saved.id, rollup, tenantConfig);
    Object.assign(saved, updated || rollup);
    lineSummary = { count: built.lines.length, weight: built.weight, pieces: built.pieces };
  }

  await history.recordChange({
    entityType: 'order',
    entityId: saved.id,
    action: 'create',
    user,
    metadata: { sync_source: syncSource, ...(extra.email_intake_id ? { email_intake_id: extra.email_intake_id } : {}) },
  });

  bus.emit(EVENTS.ORDER_CREATED, {
    id: saved.id,
    customer: saved.customer,
    origin: saved.origin,
    dest: saved.dest,
    weight: saved.weight,
    sync_source: syncSource,
    auto_synced_at: saved.auto_synced_at,
    oms_order_ref: saved.oms_order_ref || null,
    line_count: lineSummary ? lineSummary.count : null,
  });

  return saved;
}

/** Remove an order this service just created (compensation for a failed multi-order approval). */
async function rollbackCreatedOrder(orderId, user, tenantConfig = null) {
  const client = db.getClient(tenantConfig);
  await client.from('order_lines').delete().eq('order_id', orderId);
  await client.from('orders').delete().eq('id', orderId);
  await history.recordChange({ entityType: 'order', entityId: orderId, action: 'delete', user, metadata: { reason: 'rollback of partial email approval' } });
  bus.emit(EVENTS.ORDER_DELETED, { id: orderId });
}

module.exports = { createOrder, rollbackCreatedOrder, validateOrderBody, VALID_SYNC_SOURCES };
