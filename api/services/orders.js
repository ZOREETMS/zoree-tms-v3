// ═══════════════════════════════════════════════════════════════════
// Order Service — Business Logic (Tier 2)
// All order-related rules live here, not in the frontend.
// ═══════════════════════════════════════════════════════════════════

const db = require('./supabase');

// ── Field mapping: DB row → API response ──────────────────────────
function dbToOrder(r) {
  return {
    id:              r.id,
    customer:        r.customer,
    origin:          r.origin,
    destination:     r.dest,
    originZip:       r.origin_zip || null,
    destZip:         r.dest_zip || null,
    // REQ-24: surface the dedicated ship-from / ship-to name columns so the
    // frontend can render them as their own field. `ship_from_name` is
    // preserved as a snake_case alias for code paths (like the OMS push)
    // that already key off that shape.
    shipFromName:    r.ship_from_name || null,
    shipToName:      r.ship_to_name   || null,
    ship_from_name:  r.ship_from_name || null,
    ship_to_name:    r.ship_to_name   || null,
    weight:          r.weight,
    pieces:          r.pieces,
    shipMode:        r.ship_mode || null,
    // REQ-10: service_level shipped in migration 013 and apiOrderToDbPatch
    // (services/orderMutations.js) maps it on writes, but this reader was
    // missed at the time — getOrder/listOrders therefore returned orders
    // without the Service Level set, even when the column was populated.
    // Surfaces it now so any consumer of orderService (incl. the
    // /routes/orders.js router) sees the field consistently with the
    // bulk-import path that started populating it (TMS bug #145).
    serviceLevel:    r.service_level || null,
    commodity:       r.commodity,
    incoterms:       r.incoterms   || null,
    refNum:          r.ref_num || null,
    poNum:           r.po_number || null,
    readyDate:       r.ready       || null,
    dueDate:         r.due         || null,
    status:          r.status      || 'Unplanned',
    shipmentId:      r.shipment_id || null,
    noContractRate:  r.no_contract_rate || false,
    hazmat:          r.hazmat      || false,
    preferredCarrier:r.preferred_carrier || null,
    excludedCarrier: r.excluded_carrier  || null,
    noConsolidate:   r.no_consolidate    || false,
    dedicatedEquip:  r.dedicated_equip   || false,
    notes:           r.notes       || null,
    createdAt:       r.created_at,
    updatedAt:       r.updated_at,
  };
}

// ── Field mapping: API payload → DB row ───────────────────────────
function orderToDb(o) {
  return {
    id:                o.id,
    customer:          o.customer,
    origin:            o.origin,
    dest:              o.destination,
    origin_zip:        o.originZip || null,
    dest_zip:          o.destZip || null,
    // REQ-24: accept either casing — the frontend sends snake_case on
    // patches and camelCase in some create flows, and we shouldn't drop
    // the value either way. `undefined` means "caller didn't touch this
    // field" so we preserve it; an explicit empty string becomes null.
    ship_from_name:    (o.ship_from_name !== undefined ? o.ship_from_name : o.shipFromName) ?? null,
    ship_to_name:      (o.ship_to_name   !== undefined ? o.ship_to_name   : o.shipToName)   ?? null,
    weight:            parseInt(String(o.weight || 0).replace(/,/g, '')) || 0,
    pieces:            parseInt(o.pieces) || 0,
    ship_mode:         o.shipMode || null,
    // Sibling of ship_mode — REQ-10 added the column + the apiOrderToDbPatch
    // mapping but missed this writer, so anything that wrote orders through
    // services/orders.js (createOrder / updateOrder via routes/orders.js) was
    // silently dropping the field. Closes that gap so the import refactor
    // (Step B) and any future caller behave the same way.
    service_level:     o.serviceLevel || null,
    commodity:         o.commodity    || 'General',
    incoterms:         o.incoterms    || null,
    ref_num:           o.refNum || null,
    po_number:         o.poNum || o.po_number || o.po_num || null,
    ready:             o.readyDate    || null,
    due:               o.dueDate      || null,
    status:            o.status       || 'Unplanned',
    shipment_id:       o.shipmentId   || null,
    no_contract_rate:  !!(o.noContractRate || o.dualRate),
    hazmat:            !!o.hazmat,
    preferred_carrier: o.preferredCarrier || null,
    excluded_carrier:  o.excludedCarrier  || null,
    no_consolidate:    !!o.noConsolidate,
    dedicated_equip:   !!o.dedicatedEquip,
    notes:             o.notes        || null,
  };
}

// ── Business Logic: auto-consolidate orders on same lane ──────────
function groupByLane(orders) {
  const lanes = {};
  orders.forEach(o => {
    const key = `${o.origin}|${o.destination}`;
    if (!lanes[key]) lanes[key] = { lane: key, origin: o.origin, destination: o.destination, orders: [], totalWeight: 0, totalPieces: 0 };
    lanes[key].orders.push(o);
    lanes[key].totalWeight += (o.weight || 0);
    lanes[key].totalPieces += (o.pieces || 0);
  });

  // Tag partial vs full TL (assume 40,000 lbs = full TL)
  Object.values(lanes).forEach(lane => {
    lane.loadType = lane.totalWeight >= 35000 ? 'Full TL' : lane.totalWeight >= 10000 ? 'Partial TL' : 'LTL';
  });

  return Object.values(lanes);
}

// ── Validation ────────────────────────────────────────────────────
function validateOrder(o) {
  const errors = [];
  if (!o.customer)     errors.push('customer is required');
  if (!o.origin)       errors.push('origin is required');
  if (!o.destination)  errors.push('destination is required');
  if (!o.weight || o.weight <= 0) errors.push('weight must be > 0');
  return errors;
}

// ── Service Methods ───────────────────────────────────────────────

async function listOrders(filters = {}, tenantConfig = null) {
  const dbFilters = [];
  if (filters.status)   dbFilters.push(['status',   'eq',    filters.status]);
  if (filters.customer) dbFilters.push(['customer', 'ilike', `%${filters.customer}%`]);
  if (filters.statuses) dbFilters.push(['status',   'in',    filters.statuses]);

  const rows = await db.dbSelect('orders', {
    select: '*',
    filters: dbFilters,
    order: { col: 'created_at', asc: false },
    limit: filters.limit || 500,
  }, tenantConfig);

  const orders = rows.map(dbToOrder);
  return {
    orders,
    laneGroups: groupByLane(orders.filter(o => o.status === 'Unplanned')),
    total: orders.length,
  };
}

// Returns the true row count for `orders` (after the same status/customer
// filters that `listOrders` accepts) without pulling rows. Exists because
// the UI's "ORDERS" header and dashboard KPIs were reading
// `result.orders.length` from `listOrders`, which is bounded by the
// page-size cap (default 500) and therefore stops growing past 500 even
// when the table has more.
//
// Kept as a separate method (rather than rolling the count into
// `listOrders`) so callers that only need the total — header chips,
// dashboard tiles, mobile screens — don't pay for the row payload.
async function countOrders(filters = {}, tenantConfig = null) {
  const dbFilters = [];
  if (filters.status)   dbFilters.push(['status',   'eq',    filters.status]);
  if (filters.customer) dbFilters.push(['customer', 'ilike', `%${filters.customer}%`]);
  if (filters.statuses) dbFilters.push(['status',   'in',    filters.statuses]);

  return db.dbCount('orders', { filters: dbFilters }, tenantConfig);
}

async function getOrder(id, tenantConfig = null) {
  const rows = await db.dbSelect('orders', {
    filters: [['id', 'eq', id]],
    limit: 1,
  }, tenantConfig);
  if (!rows.length) throw Object.assign(new Error('Order not found'), { status: 404 });
  return dbToOrder(rows[0]);
}

async function createOrder(payload, tenantConfig = null) {
  const errors = validateOrder(payload);
  if (errors.length) throw Object.assign(new Error(errors.join(', ')), { status: 400 });

  // Generate ID if not provided
  if (!payload.id) {
    payload.id = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
  }

  const row = await db.dbUpsert('orders', orderToDb(payload), 'id', tenantConfig);
  return dbToOrder(row);
}

/**
 * Defense-in-depth guard against orphan-Planned orders.
 *
 * Background: ORD-2026-991550 was set to status='Planned' via a bare
 * PATCH from the mobile OrderDetailScreen "Plan" button, with no
 * shipment row created and `shipment_id` left null. The proper
 * planning path (bulk-plan execute) sets BOTH `status='Planned'` AND
 * `shipment_id` in one round-trip, so this guard never trips for it.
 * Anything else trying to flip an order to 'Planned' without a
 * shipment is — by definition — recreating that bug, and we'd rather
 * surface a 4xx than persist the orphan.
 *
 * Kept as a small named helper (not inline in updateOrder) so the
 * intent is clear and the rule has one place to live.
 */
function assertPlannedHasShipment(existing, updates) {
  const nextStatus = updates.status !== undefined ? updates.status : existing.status;
  if (nextStatus !== 'Planned') return;
  // Caller might explicitly set shipmentId, or leave it untouched (in
  // which case the existing value applies).
  const nextShipmentId =
    updates.shipmentId !== undefined ? updates.shipmentId
    : updates.shipment_id !== undefined ? updates.shipment_id
    : existing.shipmentId;
  if (!nextShipmentId) {
    const err = new Error(
      'Cannot set order status to "Planned" without a shipment. '
      + 'Use the bulk-plan execute endpoint (/api/bulk-plan/execute) '
      + 'so a shipment row is created and shipment_id is assigned.'
    );
    err.status = 400;
    err.code = 'PLANNED_REQUIRES_SHIPMENT';
    throw err;
  }
}

async function updateOrder(id, updates, tenantConfig = null) {
  // Merge with existing to avoid overwriting fields
  const existing = await getOrder(id, tenantConfig);
  assertPlannedHasShipment(existing, updates);
  const merged   = { ...existing, ...updates, id };
  const row = await db.dbUpdate('orders', id, orderToDb(merged), tenantConfig);
  return dbToOrder(row || merged);
}

async function deleteOrder(id, tenantConfig = null) {
  return db.dbDelete('orders', id, tenantConfig);
}

module.exports = {
  listOrders,
  countOrders,
  getOrder,
  createOrder,
  updateOrder,
  deleteOrder,
  groupByLane,
  // Exported so the legacy inline `app.patch('/api/orders/:id', ...)`
  // handler in server.js can apply the same guard without duplicating
  // the rule. Once that handler is migrated to call updateOrder(),
  // this export can go back to being internal.
  assertPlannedHasShipment,
  // Pure field mappers. Not strictly internal — they encode a stable
  // schema contract (DB row ↔ API shape) and are called by
  // createOrder/updateOrder/listOrders/getOrder above. Exported so the
  // tests in __tests__/bulkPlanImport.bugfix.test.js can pin the
  // service_level mapping that landed for TMS bug #145 (latent half).
  dbToOrder,
  orderToDb,
};
