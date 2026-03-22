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
    weight:          r.weight,
    pieces:          r.pieces,
    commodity:       r.commodity,
    incoterms:       r.incoterms   || null,
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
    weight:            parseInt(String(o.weight || 0).replace(/,/g, '')) || 0,
    pieces:            parseInt(o.pieces) || 0,
    commodity:         o.commodity    || 'General',
    incoterms:         o.incoterms    || null,
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

async function updateOrder(id, updates, tenantConfig = null) {
  // Merge with existing to avoid overwriting fields
  const existing = await getOrder(id, tenantConfig);
  const merged   = { ...existing, ...updates, id };
  const row = await db.dbUpdate('orders', id, orderToDb(merged), tenantConfig);
  return dbToOrder(row || merged);
}

async function deleteOrder(id, tenantConfig = null) {
  return db.dbDelete('orders', id, tenantConfig);
}

module.exports = { listOrders, getOrder, createOrder, updateOrder, deleteOrder, groupByLane };
