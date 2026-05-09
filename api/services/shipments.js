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
    // Bug #40 follow-up: service_level + seal_number were absent from
    // this round-trip mapper, so any caller routing through
    // updateShipment() with those keys saw them silently dropped. They
    // are part of the canonical shipment shape (service_level since
    // migration 013, seal_number since migration 015) — adding them
    // here lets the audited path handle the same payloads the legacy
    // DbApi.patch sites used to send. REQ-24 location columns
    // (origin_zip / dest_zip / ship_from_name / ship_to_name) join
    // the round trip for the same reason — updateShipmentLocations
    // (frontend/src/services/shipmentService.js) writes them through
    // this path now.
    serviceLevel:       r.service_level  || null,
    sealNumber:         r.seal_number    || null,
    originZip:          r.origin_zip     || null,
    destZip:            r.dest_zip       || null,
    shipFromName:       r.ship_from_name || null,
    shipToName:         r.ship_to_name   || null,
    // Bug #160: shipped_at / delivered_at carry the actual milestone
    // *timestamp* (TIMESTAMPTZ) — distinct from pickup_date / delivery_date
    // (DATE). The web pickup/delivery banners now read these so the
    // status flip from In Transit / Delivered surfaces with date AND time.
    shippedAt:          r.shipped_at     || null,
    deliveredAt:        r.delivered_at   || null,
    // FU-4 (post-#168): the eight columns the create-path canonicalizer
    // (`buildShipmentInsertRow`) carries also need to round-trip through
    // the read mapper so PATCH /api/shipments/:id can persist them.
    // Without this, updateShipment's `merged = {...existing, ...updates}`
    // would lose any of these keys that weren't in the incoming patch
    // (because `existing` came from this mapper). Keep this list in
    // lock-step with `shipmentToDb` and `buildShipmentInsertRow`.
    equipment:          r.equipment      || null,
    commodity:          r.commodity      || null,
    rateId:             r.rate_id        || null,
    rate:               r.rate           || 0,
    fuelSurcharge:      r.fuel_surcharge || 0,
    accessorials:       r.accessorials   || 0,
    miles:              r.miles          || 0,
    // Preserve NULL on line_items so a PATCH that doesn't touch the
    // column doesn't write an empty array back over a NULL — both are
    // semantically "no items" for readers, but rewriting NULL to [] on
    // every unrelated update would amplify writes and obscure history
    // diffs.
    lineItems:          Array.isArray(r.line_items) ? r.line_items : null,
    // Migration 021: international parity columns. Default 'USA' at the
    // DB level — read mapper surfaces whatever's stored.
    originCountry:      r.origin_country || null,
    destCountry:        r.dest_country   || null,
    // Migration 004: planning-time exception tag.
    dockIssue:          r.dock_issue     || null,
    createdAt:          r.created_at,
    updatedAt:          r.updated_at,
  };
}

// Bug #40 follow-up: snake_case → camelCase rename map for incoming
// updates. Keys not in this map pass through untouched (e.g. `status`,
// `carrier`, `notes` are spelled the same in both shapes). Used by
// updateShipment so a snake_case key from a legacy caller correctly
// overrides the existing camelCase value during merge instead of being
// dragged behind it.
const SHIPMENT_DB_TO_APP = Object.freeze({
  pickup_date:    'pickupDate',
  delivery_date:  'deliveryDate',
  total_cost:     'cost',
  bol_number:     'bolNumber',
  pro_number:     'proNumber',
  tracking_number:'trackingNumber',
  order_ids:      'consolidatedOrders',
  spot_rate:      'spotRate',
  czarlite_rate:  'czarliteRate',
  loading_start:  'loadingStart',
  loading_end:    'loadingEnd',
  dock_door:      'dockDoor',
  dock_time:      'dockTime',
  service_level:  'serviceLevel',
  seal_number:    'sealNumber',
  origin_zip:     'originZip',
  dest_zip:       'destZip',
  ship_from_name: 'shipFromName',
  ship_to_name:   'shipToName',
  shipped_at:     'shippedAt',
  delivered_at:   'deliveredAt',
  dest:           'destination',
  // FU-4 (post-#168): keep this map in lock-step with the round-trip
  // dbToShipment / shipmentToDb / buildShipmentInsertRow column set so
  // a snake_case patch from a legacy caller correctly overrides the
  // existing camelCase value during the merge in updateShipment().
  // Same-name fields (equipment, commodity, rate, accessorials, miles)
  // don't need an entry — they pass through `out[k]` untouched.
  rate_id:        'rateId',
  fuel_surcharge: 'fuelSurcharge',
  line_items:     'lineItems',
  origin_country: 'originCountry',
  dest_country:   'destCountry',
  dock_issue:     'dockIssue',
});
function normalizeShipmentUpdates(updates) {
  if (!updates || typeof updates !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(updates)) {
    out[SHIPMENT_DB_TO_APP[k] || k] = v;
  }
  return out;
}

function shipmentToDb(s) {
  // Bug #40 follow-up: tolerate both app-shape (camelCase) and DB-shape
  // (snake_case) inputs. Some legacy callers (createShipment via
  // NewShipmentModal, locationsToShipmentPatch helpers) hand the row
  // straight through with snake_case keys; others (the migrated
  // ShipmentsApi.update callers) pass canonical camelCase. Falling back
  // through both shapes per key means a single mapper handles every
  // caller without silently nulling fields it doesn't recognize.
  const pick = (camel, snake) => (s[camel] !== undefined && s[camel] !== null && s[camel] !== '' ? s[camel] : s[snake]);
  const cost = parseFloat(String(s.cost || s.total_cost || '0').replace(/[$,]/g, '')) || 0;
  return {
    id:               s.id,
    carrier:          s.carrier         || '',
    mode:             s.mode            || 'TL',
    origin:           s.origin,
    dest:             s.destination     || s.dest,
    weight:           parseInt(String(s.weight || 0).replace(/,/g, '')) || 0,
    pieces:           parseInt(s.pieces) || 0,
    status:           s.status          || 'Planned',
    pickup_date:      pick('pickupDate', 'pickup_date')         || null,
    delivery_date:    pick('deliveryDate', 'delivery_date')     || null,
    total_cost:       cost,
    bol_number:       pick('bolNumber', 'bol_number')           || null,
    pro_number:       pick('proNumber', 'pro_number')           || null,
    tracking_number:  pick('trackingNumber', 'tracking_number') || null,
    order_ids:        s.consolidatedOrders || s.order_ids || [],
    spot_rate:        !!(s.spotRate     ?? s.spot_rate),
    czarlite_rate:    !!(s.czarliteRate ?? s.czarlite_rate),
    notes:            s.notes           || null,
    loading_start:    pick('loadingStart', 'loading_start')     || null,
    loading_end:      pick('loadingEnd',   'loading_end')       || null,
    dock_door:        pick('dockDoor',     'dock_door')         || null,
    dock_time:        pick('dockTime',     'dock_time')         || null,
    service_level:    pick('serviceLevel', 'service_level')     || null,
    seal_number:      pick('sealNumber',   'seal_number')       || null,
    origin_zip:       pick('originZip',    'origin_zip')        || null,
    dest_zip:         pick('destZip',      'dest_zip')          || null,
    ship_from_name:   pick('shipFromName', 'ship_from_name')    || null,
    ship_to_name:     pick('shipToName',   'ship_to_name')      || null,
    // Bug #160: round-trip shipped_at / delivered_at so updateShipment's
    // auto-stamp on "In Transit" / "Delivered" actually persists.
    shipped_at:       pick('shippedAt',    'shipped_at')        || null,
    delivered_at:     pick('deliveredAt',  'delivered_at')      || null,
    // FU-4 (post-#168): bring shipmentToDb to parity with the create-
    // path canonicalizer (`buildShipmentInsertRow`). Before this,
    // PATCH /api/shipments/:id with any of these keys silently dropped
    // them (the rationale was "shipmentToDb does not yet know about
    // all DB columns"). Now it does — the create and update paths
    // share the same column knowledge. Numeric coercion stays
    // permissive: form inputs arrive as strings.
    equipment:        (() => {
      const v = pick('equipment', 'equipment');
      return typeof v === 'string' ? v.trim() || null : (v ?? null);
    })(),
    commodity:        pick('commodity',    'commodity')         || null,
    rate_id:          pick('rateId',       'rate_id')           || null,
    rate:             parseFloat(String(s.rate ?? 0).replace(/[$,]/g, '')) || 0,
    fuel_surcharge:   parseFloat(String(s.fuelSurcharge ?? s.fuel_surcharge ?? 0).replace(/[$,]/g, '')) || 0,
    accessorials:     parseFloat(String(s.accessorials ?? 0).replace(/[$,]/g, '')) || 0,
    miles:            parseFloat(String(s.miles ?? 0).replace(/,/g, ''))  || 0,
    line_items:       Array.isArray(s.lineItems)
                        ? s.lineItems
                        : (Array.isArray(s.line_items) ? s.line_items : null),
    // Migration 021 international parity columns. NULL passthrough
    // means the DB default ('USA') applies on insert; on update we
    // only overwrite when the caller actually sent a value (otherwise
    // updateShipment's `merged` already carries the existing value
    // through).
    origin_country:   pick('originCountry', 'origin_country') || null,
    dest_country:     pick('destCountry',   'dest_country')   || null,
    // Migration 004 planning-time exception tag.
    dock_issue:       pick('dockIssue',     'dock_issue')     || null,
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
    // Route through the collision-safe helper instead of a raw 4-digit
    // Math.random suffix. Prior code could mint an id that already
    // belonged to another shipment; dbUpsert(... 'id' ...) would then
    // merge onto the existing row instead of failing, silently reusing
    // a stale (sometimes Delivered) shipment.
    payload.id = await generateUniqueShipmentId();
  }
  const row = await db.dbUpsert('shipments', shipmentToDb(payload), 'id', tenantConfig);
  return dbToShipment(row);
}

async function updateShipment(id, updates, tenantConfig = null, context = {}) {
  const existing = await getShipment(id, tenantConfig);
  // Bug #40 follow-up: normalize the incoming `updates` to canonical
  // camelCase before merging. `existing` is camelCase (from
  // dbToShipment), so a snake_case update key would otherwise sit
  // alongside the existing camelCase one in `merged` and lose the
  // tie-breaker in shipmentToDb. Normalizing once here keeps the rest
  // of the function simple.
  const normalizedUpdates = normalizeShipmentUpdates(updates);

  // Bug #160: auto-stamp pickup / delivery milestones when the caller
  // is moving status to a milestone state and hasn't supplied a date of
  // their own. Mobile's StatusUpdateScreen (and the legacy
  // /api/shipments/:id/status route the mobile uses) only sends
  // { status: 'In Transit' }, so the web "Pickup: <date>" display
  // showed "—" forever. Mirrors the dateField/tsField semantics that
  // shipmentEvents.applyShipmentEvent uses for "Picked Up" / "Delivered".
  // Idempotent guards (`!existing.pickupDate`, etc.) keep manually-set
  // values intact.
  const incomingStatus = normalizedUpdates.status;
  const todayIso = new Date().toISOString().slice(0, 10);
  const nowIso   = new Date().toISOString();
  if (incomingStatus === 'In Transit' && existing.status !== 'In Transit') {
    if (!existing.pickupDate && !('pickupDate' in normalizedUpdates)) {
      normalizedUpdates.pickupDate = todayIso;
    }
    if (!existing.shippedAt && !('shippedAt' in normalizedUpdates)) {
      normalizedUpdates.shippedAt = nowIso;
    }
  }
  if (incomingStatus === 'Delivered' && existing.status !== 'Delivered') {
    if (!existing.deliveryDate && !('deliveryDate' in normalizedUpdates)) {
      normalizedUpdates.deliveryDate = todayIso;
    }
    if (!existing.deliveredAt && !('deliveredAt' in normalizedUpdates)) {
      normalizedUpdates.deliveredAt = nowIso;
    }
  }

  const merged   = { ...existing, ...normalizedUpdates, id };
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

// ────────────────────────────────────────────────────────────────────
// recordRawPatchAudit — Bug #40: legacy DbApi.patch("shipments", …)
// call sites bypass updateShipment() and write directly via dbUpdate,
// so a status='Tendered' transition produced no change_history row and
// the Shipment Timeline had no source for the "Tendered to Carrier"
// timestamp (it rendered "Confirmed").
//
// Historical note: this helper used to exist because shipmentToDb did
// not know about all DB columns (service_level, seal_number, …, plus
// the FU-4 set: equipment, commodity, rate_id, rate, fuel_surcharge,
// accessorials, miles, line_items, origin_country, dest_country,
// dock_issue) and delegating to updateShipment would silently drop
// the unknown ones. As of FU-4 (post-#168) shipmentToDb is at parity
// with the table, so this helper is no longer load-bearing for column
// preservation.
//
// We keep it because the generic /api/db/:table/:id PATCH endpoint
// is still in active use (dock-scheduling edits, OMS bridge, ad-hoc
// admin patches) and going through it bypasses updateShipment(). The
// helper replays the same audit + OMS-mirror logic that
// updateShipment runs, driven by a DB-shape (snake_case) patch body
// and the existing/updated DB rows. Best-effort: the patch is already
// committed — audit failures must not roll back the user's update.
//
// Future: once every caller is migrated to PATCH /api/shipments/:id
// (which uses updateShipment), this helper can be retired.
// ────────────────────────────────────────────────────────────────────
async function recordRawPatchAudit({ id, before, after, user, via }) {
  if (!id || !before || !after) return;
  const ctxVia = via || 'db-patch';

  // 1. Status change → write the same status row updateShipment writes.
  if ((before.status || null) !== (after.status || null)) {
    try {
      await history.recordChange({
        entityType: 'shipment',
        entityId:   id,
        action:     'status',
        field:      'status',
        before:     before.status || null,
        after:      after.status,
        user:       user || null,
        metadata:   { via: ctxVia },
      });
    } catch (auditErr) {
      console.error('[shipments] raw-patch status history failed:', auditErr.message);
    }

    // Cascade to linked orders for the same status transitions
    // updateShipment cares about (Tendered, In Transit, Delivered, …).
    if (SHIPMENT_STATUS_TO_ORDER_STATUS[after.status]) {
      try {
        await syncLinkedOrdersForShipmentStatus({
          shipmentId: id,
          newStatus:  after.status,
          user:       user || null,
          via:        ctxVia,
        });
      } catch (syncErr) {
        console.error('[shipments] raw-patch order sync failed:', syncErr.message);
      }
    }
  }

  // 2. Dock-field changes → audit per field and trigger the OMS dock
  //    mirror. Mirrors the dockChanged branch in updateShipment.
  const DOCK_FIELDS_DB = ['dock_door', 'dock_time', 'loading_start', 'loading_end'];
  const dockChanged = DOCK_FIELDS_DB.some((k) => (before[k] || null) !== (after[k] || null));
  if (dockChanged) {
    for (const dbField of DOCK_FIELDS_DB) {
      const beforeVal = before[dbField] || null;
      const afterVal  = after[dbField]  || null;
      if (beforeVal === afterVal) continue;
      try {
        // Translate DB column → camelCase app field for the audit row,
        // matching what updateShipment writes (so the History tab and
        // dock OMS mirror see a single, consistent shape).
        const camelMap = {
          dock_door: 'dockDoor', dock_time: 'dockTime',
          loading_start: 'loadingStart', loading_end: 'loadingEnd',
        };
        await history.recordChange({
          entityType: 'shipment',
          entityId:   id,
          action:     'update',
          field:      camelMap[dbField] || dbField,
          before:     beforeVal,
          after:      afterVal,
          user:       user || null,
          metadata:   { via: ctxVia },
        });
      } catch (auditErr) {
        console.error('[shipments] raw-patch dock history failed:', auditErr.message);
      }
    }
    try {
      const sync = omsSync().syncDockToOms;
      if (typeof sync === 'function') {
        await sync({
          shipmentId:   id,
          dockDoor:     after.dock_door     || null,
          dockTime:     after.dock_time     || null,
          loadingStart: after.loading_start || null,
          loadingEnd:   after.loading_end   || null,
        }, user || null);
      }
    } catch (mirrorErr) {
      console.error('[shipments] raw-patch dock OMS mirror failed:', mirrorErr.message);
    }
  }
}

// ════════════════════════════════════════════════════════════════════
// FU-3 (post-#168): canonical mapper for the *create* path.
//
// The active POST /api/shipments handler in api/server.js used to do
// `dbUpsert('shipments', req.body, null)` directly, which meant the
// snake_case-vs-camelCase mapping AND the column whitelist lived in
// every caller (web, mobile, OMS bridge). Three separate hand-built
// mappers had drifted apart — equipment, commodity, rate_id, rate,
// fuel_surcharge, accessorials, miles, line_items were known to one
// caller but not another, and no `shipmentToDb` knew about them
// either (`shipmentToDb` is intentionally update-shaped — see the
// comment around recordRawPatchAudit for why we don't extend it).
//
// `buildShipmentInsertRow` is the create-path canonicalizer. It
// accepts either shape per key (the `pick` pattern shipmentToDb
// already uses), enumerates every column the shipments table accepts
// at insert time, and returns a clean snake_case row. New columns
// added to the table only need a line here, not three places.
//
// Strips audit-only metadata (`copiedFrom`, `_carrier`, `_commodity`,
// `_linkedOrders`, …) so the row write doesn't 400 on unknown columns.
// Caller is responsible for pulling those back out of req.body before
// calling us if they need them for the change_history row (the POST
// handler already does this for `copiedFrom`).
// ════════════════════════════════════════════════════════════════════
function buildShipmentInsertRow(input) {
  if (!input || typeof input !== 'object') return {};
  const s = input;
  const pick = (camel, snake) =>
    s[camel] !== undefined && s[camel] !== null && s[camel] !== ''
      ? s[camel]
      : s[snake];

  const num = (camel, snake) => {
    const v = pick(camel, snake);
    if (v === undefined || v === null || v === '') return 0;
    const n = parseFloat(String(v).replace(/[$,]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  const intOrZero = (camel, snake) => {
    const v = pick(camel, snake);
    if (v === undefined || v === null || v === '') return 0;
    const n = parseInt(String(v).replace(/,/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
  };

  const blankToNull = (v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'string' && v.trim() === '') return null;
    return v;
  };

  const equipmentRaw = pick('equipment', 'equipment');
  const equipment =
    typeof equipmentRaw === 'string' ? equipmentRaw.trim() || null : (equipmentRaw ?? null);

  const lineItemsRaw = pick('lineItems', 'line_items');
  const lineItems = Array.isArray(lineItemsRaw) ? lineItemsRaw : null;

  const orderIds = Array.isArray(s.consolidatedOrders)
    ? s.consolidatedOrders
    : Array.isArray(s.order_ids)
      ? s.order_ids
      : [];

  // Only set id when the caller supplied one. The POST handler decides
  // whether to pre-fill (legacy clients) or let generateUniqueShipmentId
  // assign one (post-#168 clients).
  const row = {
    carrier:        s.carrier || '',
    mode:           s.mode || 'TL',
    origin:         s.origin || null,
    dest:           s.destination || s.dest || null,
    weight:         intOrZero('weight', 'weight'),
    pieces:         intOrZero('pieces', 'pieces'),
    status:         s.status || 'Planned',
    pickup_date:    blankToNull(pick('pickupDate',    'pickup_date')),
    delivery_date:  blankToNull(pick('deliveryDate',  'delivery_date')),
    total_cost:     num('cost',           'total_cost'),
    bol_number:     blankToNull(pick('bolNumber',     'bol_number')),
    pro_number:     blankToNull(pick('proNumber',     'pro_number')),
    tracking_number:blankToNull(pick('trackingNumber','tracking_number')),
    order_ids:      orderIds,
    spot_rate:      !!(s.spotRate     ?? s.spot_rate),
    czarlite_rate:  !!(s.czarliteRate ?? s.czarlite_rate),
    notes:          s.notes ?? null,
    loading_start:  blankToNull(pick('loadingStart',  'loading_start')),
    loading_end:    blankToNull(pick('loadingEnd',    'loading_end')),
    dock_door:      blankToNull(pick('dockDoor',      'dock_door')),
    dock_time:      blankToNull(pick('dockTime',      'dock_time')),
    service_level:  pick('serviceLevel', 'service_level') || null,
    seal_number:    blankToNull(pick('sealNumber',    'seal_number')),
    origin_zip:     blankToNull(pick('originZip',     'origin_zip')),
    dest_zip:       blankToNull(pick('destZip',       'dest_zip')),
    ship_from_name: blankToNull(pick('shipFromName',  'ship_from_name')),
    ship_to_name:   blankToNull(pick('shipToName',    'ship_to_name')),
    shipped_at:     blankToNull(pick('shippedAt',     'shipped_at')),
    delivered_at:   blankToNull(pick('deliveredAt',   'delivered_at')),
    // ── New: previously diverging across mappers ────────────────────
    equipment,
    commodity:      blankToNull(pick('commodity',    'commodity')),
    rate_id:        blankToNull(pick('rateId',       'rate_id')),
    rate:           num('rate',          'rate'),
    fuel_surcharge: num('fuelSurcharge', 'fuel_surcharge'),
    accessorials:   num('accessorials',  'accessorials'),
    miles:          num('miles',         'miles'),
    line_items:     lineItems,
    // Migration 021: international parity columns. Default of 'USA' is
    // applied at the DB level; only forward when the caller actually
    // sets them so we don't stomp the default with NULL.
    origin_country: pick('originCountry', 'origin_country') || undefined,
    dest_country:   pick('destCountry',   'dest_country')   || undefined,
    // Migration 004: planning-time exception tag. Bulk-plan path sets
    // this; the canonicalizer surfaces it for any future create
    // caller that needs it (copyShipment carrying forward the tag,
    // EDI ingest, etc.).
    dock_issue:     pick('dockIssue', 'dock_issue') || null,
  };

  // Strip any keys whose value resolved to `undefined` so we don't
  // ship `{ origin_country: undefined }` to PostgREST (which would
  // otherwise overwrite the column default with NULL).
  for (const k of Object.keys(row)) {
    if (row[k] === undefined) delete row[k];
  }

  if (s.id) row.id = s.id;
  return row;
}

// ════════════════════════════════════════════════════════════════════
// FU-2 (post-#168): server-issued shipment IDs with widened entropy.
//
// The previous client-side generator picked a 4-digit random suffix,
// giving roughly 1/9_000 collision odds at any given year-tenant
// combination. The server's `dbUpsert` uses `Prefer:
// resolution=merge-duplicates`, so a colliding id silently merged
// into the existing row instead of erroring — manifesting as a
// "phantom overwrite" of an unrelated shipment. We saw this in
// production once already (QA #168 reproduction) on the mobile path.
//
// 6-digit suffix drops collision odds to ~1/900_000, and we
// pre-check existence via dbSelect with a small retry loop so even a
// rare collision lands on a fresh id. Pure deterministic behaviour
// in tests is preserved by allowing the caller to inject `random`
// (Math.random by default).
//
// Ids are still SHP-YYYY-N… so they remain user-recognizable and
// every screen / search / clipboard recipe that already special-cases
// the prefix keeps working.
// ════════════════════════════════════════════════════════════════════
async function generateUniqueShipmentId({
  maxAttempts = 5,
  random = Math.random,
  exists = defaultIdExists,
} = {}) {
  const year = new Date().getFullYear();
  for (let i = 0; i < maxAttempts; i++) {
    const suffix = Math.floor(100000 + random() * 900000); // 6 digits
    const candidate = `SHP-${year}-${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    const taken = await exists(candidate).catch(() => false);
    if (!taken) return candidate;
  }
  // Extreme fallback: timestamp-based suffix. Collision now requires
  // two creates in the same millisecond on the same year — acceptable.
  return `SHP-${year}-${(Date.now() % 1_000_000).toString().padStart(6, '0')}`;
}

async function defaultIdExists(id) {
  const rows = await db
    .dbSelect('shipments', { filters: [['id', 'eq', id]], limit: 1 }, null)
    .catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

module.exports = {
  listShipments,
  getShipment,
  createShipment,
  updateShipment,
  estimateCost,
  recordRawPatchAudit,
  buildShipmentInsertRow,
  generateUniqueShipmentId,
};
