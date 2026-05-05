// ═══════════════════════════════════════════════════════════════════
// Shipment Service — Business Logic (Tier 2)
// ═══════════════════════════════════════════════════════════════════

const db = require('./supabase');
const history = require('./changeHistory');
const { syncLinkedOrdersForShipmentStatus, SHIPMENT_STATUS_TO_ORDER_STATUS } =
  require('./shipmentEvents');
// Lazy-required to avoid a circular load with omsSync (which itself
// imports shipment helpers in some paths). Resolved at call time so the
// dock-mirror only fires when actually triggered by updateShipment().
function omsSync() { return require('./omsSync'); }

function dbToShipment(r) {
  return {
    id:                 r.id,
    carrier:            r.carrier,
    mode:               r.mode           || 'TL',
    origin:             r.origin,
    destination:        r.dest,
    weight:             r.weight,
    pieces:             r.pieces,
    status:             r.status         || 'Planned',
    pickupDate:         r.pickup_date    || null,
    deliveryDate:       r.delivery_date  || null,
    cost:               r.total_cost     || 0,
    bolNumber:          r.bol_number     || null,
    proNumber:          r.pro_number     || null,
    trackingNumber:     r.tracking_number|| null,
    consolidatedOrders: r.order_ids      || [],
    spotRate:           r.spot_rate      || false,
    czarliteRate:       r.czarlite_rate  || false,
    notes:              r.notes          || null,
    loadingStart:       r.loading_start  || null,
    loadingEnd:         r.loading_end    || null,
    dockDoor:           r.dock_door      || null,
    dockTime:           r.dock_time      || null,
    createdAt:          r.created_at,
    updatedAt:          r.updated_at,
  };
}

function shipmentToDb(s) {
  const cost = parseFloat(String(s.cost || '0').replace(/[$,]/g, '')) || 0;
  return {
    id:               s.id,
    carrier:          s.carrier         || '',
    mode:             s.mode            || 'TL',
    origin:           s.origin,
    dest:             s.destination,
    weight:           parseInt(String(s.weight || 0).replace(/,/g, '')) || 0,
    pieces:           parseInt(s.pieces) || 0,
    status:           s.status          || 'Planned',
    pickup_date:      s.pickupDate      || null,
    delivery_date:    s.deliveryDate    || null,
    total_cost:       cost,
    bol_number:       s.bolNumber       || null,
    pro_number:       s.proNumber       || null,
    tracking_number:  s.trackingNumber  || null,
    order_ids:        s.consolidatedOrders || [],
    spot_rate:        !!s.spotRate,
    czarlite_rate:    !!s.czarliteRate,
    notes:            s.notes           || null,
    loading_start:    s.loadingStart    || null,
    loading_end:      s.loadingEnd      || null,
    dock_door:        s.dockDoor        || null,
    dock_time:        s.dockTime        || null,
  };
}

// ── Business Logic: calculate freight cost estimate ───────────────
function estimateCost(weight, miles, ratePerMile = 2.50, fscPct = 20) {
  const base = weight * ratePerMile / 100; // rate per CWT
  const fsc  = base * (fscPct / 100);
  return Math.round((base + fsc) * 100) / 100;
}

// ── Business Logic: determine if shipment is late ─────────────────
function isLate(shipment) {
  if (!shipment.deliveryDate) return false;
  return new Date() > new Date(shipment.deliveryDate) &&
         !['Delivered', 'Cancelled'].includes(shipment.status);
}

async function listShipments(filters = {}, tenantConfig = null) {
  const dbFilters = [];
  if (filters.status)   dbFilters.push(['status', 'eq',  filters.status]);
  if (filters.carrier)  dbFilters.push(['carrier','ilike',`%${filters.carrier}%`]);

  const rows = await db.dbSelect('shipments', {
    filters: dbFilters,
    order:   { col: 'created_at', asc: false },
    limit:   filters.limit || 500,
  }, tenantConfig);

  const shipments = rows.map(dbToShipment);
  return {
    shipments,
    stats: {
      total:     shipments.length,
      inTransit: shipments.filter(s => s.status === 'In Transit').length,
      planned:   shipments.filter(s => s.status === 'Planned').length,
      delivered: shipments.filter(s => s.status === 'Delivered').length,
      late:      shipments.filter(isLate).length,
    },
  };
}

async function getShipment(id, tenantConfig = null) {
  const rows = await db.dbSelect('shipments', {
    filters: [['id', 'eq', id]], limit: 1,
  }, tenantConfig);
  if (!rows.length) throw Object.assign(new Error('Shipment not found'), { status: 404 });
  return dbToShipment(rows[0]);
}

async function createShipment(payload, tenantConfig = null) {
  if (!payload.id) {
    const year = new Date().getFullYear();
    payload.id = `SHP-${year}-${Math.floor(1000 + Math.random() * 9000)}`;
  }
  const row = await db.dbUpsert('shipments', shipmentToDb(payload), 'id', tenantConfig);
  return dbToShipment(row);
}

async function updateShipment(id, updates, tenantConfig = null, context = {}) {
  const existing = await getShipment(id, tenantConfig);
  const merged   = { ...existing, ...updates, id };
  const row = await db.dbUpdate('shipments', id, shipmentToDb(merged), tenantConfig);
  const next = dbToShipment(row || merged);

  // ── Dock-assignment mirror ─────────────────────────────────────────
  // When dock_door / dock_time / loading_start / loading_end change
  // outside the bulk-plan/tender-accept paths (e.g. dock-scheduling
  // edit), mirror the new window into linked oms_orders so the OMS
  // Load & Ship modal stays in sync. Best-effort — never roll back the
  // shipment update if the mirror fails.
  const dockFields = ['dockDoor', 'dockTime', 'loadingStart', 'loadingEnd'];
  const dockChanged = dockFields.some((k) => (existing[k] || null) !== (next[k] || null));
  if (dockChanged) {
    for (const field of dockFields) {
      const before = existing[field] || null;
      const after  = next[field]     || null;
      if (before === after) continue;
      try {
        await history.recordChange({
          entityType: 'shipment',
          entityId:   id,
          action:     'update',
          field,
          before,
          after,
          user:       context.user || null,
          metadata:   { via: context.via || 'shipment-update' },
        });
      } catch (auditErr) {
        console.error('[shipments] dock history failed:', auditErr.message);
      }
    }
    try {
      const sync = omsSync().syncDockToOms;
      if (typeof sync === 'function') {
        await sync({
          shipmentId:   id,
          dockDoor:     next.dockDoor     || null,
          dockTime:     next.dockTime     || null,
          loadingStart: next.loadingStart || null,
          loadingEnd:   next.loadingEnd   || null,
        }, context.user || null);
      }
    } catch (mirrorErr) {
      console.error('[shipments] dock OMS mirror failed:', mirrorErr.message);
    }
  }

  // Detect a status transition that the sync map cares about and
  // propagate it to linked orders via the single-source-of-truth helper
  // in shipmentEvents.js. Terminal order states are protected inside
  // the helper (Delivered/Cancelled never regress).
  const statusChanged = existing.status !== next.status;
  const shouldSync    = statusChanged && !!SHIPMENT_STATUS_TO_ORDER_STATUS[next.status];

  if (statusChanged) {
    try {
      await history.recordChange({
        entityType: 'shipment',
        entityId:   id,
        action:     'status',
        field:      'status',
        before:     existing.status || null,
        after:      next.status,
        user:       context.user || null,
        metadata:   { via: context.via || 'shipment-update' },
      });
    } catch (auditErr) {
      console.error('[shipments] status history failed:', auditErr.message);
    }
  }

  if (shouldSync) {
    try {
      await syncLinkedOrdersForShipmentStatus({
        shipmentId: id,
        newStatus:  next.status,
        user:       context.user || null,
        via:        context.via  || 'shipment-update',
      });
    } catch (syncErr) {
      console.error('[shipments] order sync failed:', syncErr.message);
    }
  }

  return next;
}

module.exports = { listShipments, getShipment, createShipment, updateShipment, estimateCost };
