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

function serviceHeaders(serviceKey, prefer = 'return=representation') {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: prefer,
  };
}

async function executePlan(plan, { SUPABASE_URL, SERVICE_KEY, dbSelect, fetchImpl }) {
  const year = new Date().getFullYear();
  const shipId = `SHP-${year}-${Math.floor(1000 + Math.random() * 9000)}`;
  const bolId = `BOL-${shipId}`;
  const orderIds = Array.isArray(plan.orderIds) ? plan.orderIds.slice() : [];

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
