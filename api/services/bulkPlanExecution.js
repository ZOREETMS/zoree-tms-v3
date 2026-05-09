// ═══════════════════════════════════════════════════════════════════
// Bulk Plan Execution — REQ-05 perf pass
//
// The flow for a single plan:
//   1. Insert the shipment row (already carries bol_number = BOL-<shipId>,
//      so we don't need a follow-up PATCH).
//   2. In parallel with the shipment insert completing, read lines +
//      orders for the BOL payload.
//   3. Fire-and-forget the BOL document insert + batch-patch all orders
//      on the plan in ONE call via PostgREST's id=in.(...) filter.
//
// The outer loop runs all plans in parallel with Promise.all so multiple
// lanes execute concurrently.
//
// Compared to the prior sequential implementation this cuts a 35-order
// multi-lane run from ~12s down to a handful of seconds.
// ═══════════════════════════════════════════════════════════════════

// Lazy require so the dock-mirror service is only loaded when bulk-plan
// runs in the API process (keeps test harnesses that import this module
// in isolation from needing the full Supabase wiring).
let _omsSync = null;
function omsSync() {
  if (_omsSync) return _omsSync;
  try { _omsSync = require('./omsSync'); } catch (_) { _omsSync = {}; }
  return _omsSync;
}

// Reuse the canonical id generator from the shipments service so the
// bulk-plan path benefits from the 6-digit suffix space + existence
// pre-check + retry loop. Prior implementation used a 4-digit
// Math.random() suffix with no uniqueness check, which collided with
// existing shipment ids in production once a few hundred shipments
// existed for the year (birthday paradox). On collision the downstream
// dbUpsert merged onto the existing row instead of failing, silently
// reassigning new orders onto an already-Delivered shipment.
const { generateUniqueShipmentId } = require('./shipments');

function serviceHeaders(serviceKey, prefer = 'return=representation') {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: prefer,
  };
}

// Migration 031: snapshot of the consolidated commodity at plan time.
// Mirrors frontend/src/utils/shipmentFromOrders.js#deriveCommodityFromOrders
// (DISTINCT non-empty commodity values joined with ", ", alphabetically
// ordered for determinism so the snapshot matches the backfill output).
//
// Kept in this file (not pulled into a shared helper) because the plan
// is the only server-side write path that needs it — the copy path
// reuses the source's already-snapshotted column. Inlining here avoids
// growing the surface area for a one-line aggregation.
function deriveCommodityFromOrderRows(orderRows) {
  if (!Array.isArray(orderRows) || orderRows.length === 0) return null;
  const unique = new Set();
  for (const o of orderRows) {
    const c = o && typeof o.commodity === 'string' ? o.commodity.trim() : '';
    if (c) unique.add(c);
  }
  if (unique.size === 0) return null;
  return [...unique].sort().join(', ');
}

// Fetch the commodity column for every order in a plan in a single
// PostgREST round-trip (`id=in.(...)`), aggregate, and return the
// snapshot string. Returns null on empty input or any fetch error so
// the caller can fall through to inserting commodity = NULL — never
// fails the plan over a snapshot read.
async function fetchCommoditySnapshot(orderIds, dbSelect) {
  if (!Array.isArray(orderIds) || orderIds.length === 0) return null;
  try {
    const idList = orderIds
      .filter(Boolean)
      .map((id) => encodeURIComponent(id))
      .join(',');
    if (!idList) return null;
    const rows = await dbSelect('orders', `select=commodity&id=in.(${idList})`, null);
    return deriveCommodityFromOrderRows(rows);
  } catch (_) {
    return null;
  }
}

// Migration 032: snapshot of consolidated order_lines at plan time so
// the Shipment Details modal renders a Line Items table on Copy
// Shipment (which drops order_ids) and on detached shipments. Element
// shape matches what frontend/src/pages/ShipmentsPage.jsx reads from
// the per-order fetch path:
//   { order_id, line_num, item_id, description,
//     qty_ordered, unit_weight, total_weight }
// Sorted (order_id, line_num) for determinism with the SQL backfill
// in migration 032 (jsonb_agg ORDER BY ol.order_id, ol.line_num).
async function fetchLineItemsSnapshot(orderIds, dbSelect) {
  if (!Array.isArray(orderIds) || orderIds.length === 0) return [];
  try {
    const idList = orderIds
      .filter(Boolean)
      .map((id) => encodeURIComponent(id))
      .join(',');
    if (!idList) return [];
    const rows = await dbSelect(
      'order_lines',
      `select=order_id,line_num,item_id,description,qty_ordered,unit_weight,total_weight`
        + `&order_id=in.(${idList})&order=order_id.asc,line_num.asc`,
      null,
    );
    if (!Array.isArray(rows)) return [];
    // Normalize null/undefined fields to the shape the modal expects.
    // Defensive defaults match the modal's `|| 0` / `|| ""` reads.
    return rows.map((r) => ({
      order_id:     r.order_id     || null,
      line_num:     r.line_num     || null,
      item_id:      r.item_id      || null,
      description:  r.description  || '',
      qty_ordered:  r.qty_ordered  || 0,
      unit_weight:  r.unit_weight  || 0,
      total_weight: r.total_weight || 0,
    }));
  } catch (_) {
    return [];
  }
}

async function executePlan(plan, { SUPABASE_URL, SERVICE_KEY, dbSelect, fetchImpl }) {
  // Use the shipments-service helper. Pass an `exists` callback wired to
  // the injected dbSelect so this stays mockable in tests (the default
  // helper would reach for the singleton db module instead).
  const shipId = await generateUniqueShipmentId({
    exists: async (candidate) => {
      const rows = await dbSelect(
        'shipments',
        { filters: [['id', 'eq', candidate]], limit: 1 },
        null,
      ).catch(() => []);
      return Array.isArray(rows) && rows.length > 0;
    },
  });
  const bolId = `BOL-${shipId}`;
  const orderIds = Array.isArray(plan.orderIds) ? plan.orderIds.slice() : [];

  // Migrations 031 + 032: snapshot consolidated commodity AND line
  // items at plan time so the Shipment Details modal renders both on
  // Copy Shipment (which drops order_ids) and on detached/standalone
  // shipments. Two independent PostgREST round-trips, parallelized
  // via Promise.all so we don't pay them serially. Both helpers
  // swallow errors and fall through to empty snapshots so a snapshot
  // read never breaks plan execution.
  const [commoditySnapshot, lineItemsSnapshot] = await Promise.all([
    fetchCommoditySnapshot(orderIds, dbSelect),
    fetchLineItemsSnapshot(orderIds, dbSelect),
  ]);

  const shipRow = {
    id: shipId,
    carrier: plan.carrier || '',
    mode: plan.mode || 'LTL',
    origin: plan.origin,
    dest: plan.destination,
    // REQ-24: carry the human-friendly ship-from / ship-to name (and the
    // matching ZIPs) onto the shipment row. Legacy plans may not send
    // these fields yet, so default to null.
    origin_zip:     plan.originZip    || null,
    dest_zip:       plan.destZip      || null,
    ship_from_name: plan.shipFromName || null,
    ship_to_name:   plan.shipToName   || null,
    // Migration 021: persist country codes on the shipment so future
    // re-quoting can honor rates with match_type='country_to_country'.
    // Defaults to 'USA' when the plan omits them — matches DB default.
    origin_country: plan.originCountry || 'USA',
    dest_country:   plan.destCountry   || 'USA',
    weight: plan.totalWeight || 0,
    pieces: plan.totalPieces || 0,
    status: 'Planned',
    total_cost: plan.totalCost || 0,
    rate: plan.rate || 0,
    fuel_surcharge: plan.fuelSurcharge || 0,
    accessorials: plan.accessorials || 0,
    order_ids: orderIds,
    pickup_date: plan.pickupDate || null,
    delivery_date: plan.deliveryDate || null,
    czarlite_rate: !!plan.czarliteRate || (plan.mode || '').toUpperCase() === 'LTL',
    service_level: plan.serviceLevel || null,
    miles: plan.miles || null,
    rate_id: plan.rateId || null,
    // Migration 025: snapshot the rate's equipment onto the shipment so
    // the detail UI can display the trailer this load was planned for
    // without re-joining to the rate row. NULL when the matched rate
    // didn't carry an equipment value (legacy / non-LTL/TL modes).
    equipment: plan.equipment || null,
    // Migration 031: commodity snapshot from the plan's orderIds.
    // Backs the Shipment Details modal's terminal fallback so Copy
    // Shipment (which intentionally drops order_ids) and detached
    // shipments still render Commodity instead of "—".
    commodity: commoditySnapshot,
    // Migration 032: line_items snapshot from the plan's orderIds.
    // Same rationale as commodity — the modal's Line Items table
    // would render empty on Copy Shipment without this snapshot,
    // since the copy intentionally doesn't carry order_ids forward.
    line_items: lineItemsSnapshot,
    // Fold the BOL number in at insert time so we don't need a follow-up PATCH.
    bol_number: bolId,
  };
  if (plan.dockDoor)     shipRow.dock_door     = plan.dockDoor;
  if (plan.dockTime)     shipRow.dock_time     = plan.dockTime;
  if (plan.loadingStart) shipRow.loading_start = plan.loadingStart;
  if (plan.loadingEnd)   shipRow.loading_end   = plan.loadingEnd;
  if (plan.dockIssue)    shipRow.dock_issue    = plan.dockIssue;

  // ── 1. Insert the shipment ─────────────────────────────────────
  const shipRes = await fetchImpl(`${SUPABASE_URL}/rest/v1/shipments?on_conflict=id`, {
    method: 'POST',
    headers: serviceHeaders(SERVICE_KEY, 'resolution=merge-duplicates,return=representation'),
    body: JSON.stringify(shipRow),
  });
  const shipData = await shipRes.json().catch(() => ({}));
  if (!shipRes.ok) {
    // Surface the legacy "dock_door missing" hint separately so the caller can log it.
    const msg = shipData?.message || 'DB insert failed';
    if (msg.includes('dock_door')) {
      return { shipment: null, ordersUpdated: 0, errors: [{ shipId, error: 'Dock columns missing in DB — run pending migrations' }] };
    }
    return { shipment: null, ordersUpdated: 0, errors: [{ shipId, error: msg }] };
  }
  const created = Array.isArray(shipData) ? shipData[0] : shipData;

  // ── 2. Batch-patch all orders AND build the BOL in parallel ───
  const patchOrdersPromise = (async () => {
    if (!orderIds.length) return { ordersUpdated: 0, errors: [] };
    const inFilter = orderIds.map((id) => encodeURIComponent(id)).join(',');
    const ordPatchRes = await fetchImpl(
      `${SUPABASE_URL}/rest/v1/orders?id=in.(${inFilter})`,
      {
        method: 'PATCH',
        headers: serviceHeaders(SERVICE_KEY, 'return=minimal'),
        body: JSON.stringify({ status: 'Planned', shipment_id: shipId }),
      }
    );
    if (!ordPatchRes.ok) {
      return {
        ordersUpdated: 0,
        errors: [{ shipId, error: `Batch order patch failed (${ordPatchRes.status})` }],
      };
    }
    return { ordersUpdated: orderIds.length, errors: [] };
  })();

  // BOL is best-effort — log nothing, swallow errors, don't block the caller.
  const bolPromise = (async () => {
    if (!orderIds.length) return;
    try {
      const [linesArrays, orderArrays] = await Promise.all([
        Promise.all(orderIds.map((oid) =>
          dbSelect('order_lines', `select=*&order_id=eq.${encodeURIComponent(oid)}&order=line_num.asc`, null).catch(() => [])
        )),
        Promise.all(orderIds.map((oid) =>
          dbSelect('orders', `select=*&id=eq.${encodeURIComponent(oid)}`, null).catch(() => [])
        )),
      ]);
      const allLines = linesArrays.flat();
      const linkedOrders = orderArrays.flat();
      const incoterms = linkedOrders.map((o) => o && o.incoterms).find(Boolean) || null;
      const today = new Date().toISOString().split('T')[0];
      const bolRow = {
        id: bolId,
        type: 'BOL',
        status: 'Pending',
        ship: shipId,
        carrier: shipRow.carrier,
        generated: today,
        origin: shipRow.origin,
        dest: shipRow.dest,
        weight: shipRow.weight,
        pieces: shipRow.pieces,
        mode: shipRow.mode,
        pickup_date: shipRow.pickup_date,
        delivery_date: shipRow.delivery_date,
        order_ids: orderIds,
        orders: linkedOrders,
        line_items: allLines,
        incoterms,
      };
      await fetchImpl(`${SUPABASE_URL}/rest/v1/documents?on_conflict=id`, {
        method: 'POST',
        headers: serviceHeaders(SERVICE_KEY, 'resolution=merge-duplicates,return=minimal'),
        body: JSON.stringify(bolRow),
      });
    } catch (_) { /* best-effort */ }
  })();

  const [patched] = await Promise.all([patchOrdersPromise, bolPromise]);

  // Mirror the dock assignment back into oms_orders so the OMS Load &
  // Ship modal (`_omsBaseHdr` → `o.dockDoor`) shows the dock instead of
  // "—". syncTenderAcceptToOms only fires on tender-accept; without
  // this hop, a dock assigned at bulk-plan time never reaches OMS.
  // Gate on the columns oms_orders actually has: dock_door,
  // loading_start, loading_end. dock_time has no OMS counterpart.
  // Best-effort: never roll back the shipment if the mirror fails.
  if (orderIds.length && (plan.dockDoor || plan.loadingStart || plan.loadingEnd)) {
    try {
      const sync = omsSync().syncDockToOms;
      if (typeof sync === 'function') {
        await sync({
          shipmentId:   shipId,
          orderIds,
          dockDoor:     plan.dockDoor     || null,
          loadingStart: plan.loadingStart || null,
          loadingEnd:   plan.loadingEnd   || null,
        }, { email: 'bulk-plan-execute' });
      }
    } catch (omsErr) {
      // Non-fatal — log and continue. The shipment + order patch already
      // succeeded; the OMS mirror can be retried by the middleware pull.
      console.warn('[bulkPlanExecution] OMS dock mirror failed for', shipId, '-', omsErr.message);
    }
  }

  return {
    shipment: created,
    ordersUpdated: patched.ordersUpdated,
    errors: patched.errors,
  };
}

async function executeBulkPlans(plans, { SUPABASE_URL, SERVICE_KEY, dbSelect, fetchImpl = fetch }) {
  if (!Array.isArray(plans) || plans.length === 0) {
    return { shipments: [], ordersUpdated: 0, errors: [] };
  }

  // Run every plan concurrently. Each plan is independent (distinct shipment
  // ids, distinct order sets). Promise.all lets multiple lanes execute in
  // parallel rather than queueing behind each other.
  const results = await Promise.all(
    plans.map(async (plan) => {
      try {
        return await executePlan(plan, { SUPABASE_URL, SERVICE_KEY, dbSelect, fetchImpl });
      } catch (planErr) {
        return { shipment: null, ordersUpdated: 0, errors: [{ lane: plan.laneKey, error: planErr.message }] };
      }
    })
  );

  const shipments = [];
  const errors = [];
  let ordersUpdated = 0;
  for (const r of results) {
    if (r.shipment) shipments.push(r.shipment);
    ordersUpdated += r.ordersUpdated || 0;
    if (Array.isArray(r.errors) && r.errors.length) errors.push(...r.errors);
  }
  return { shipments, ordersUpdated, errors };
}

module.exports = { executeBulkPlans, executePlan };
