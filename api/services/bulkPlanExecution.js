function serviceHeaders(serviceKey, prefer = 'return=representation') {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: prefer,
  };
}

async function executeBulkPlans(plans, { SUPABASE_URL, SERVICE_KEY, dbSelect, fetchImpl = fetch }) {
  const shipments = [];
  const errors = [];
  let ordersUpdated = 0;

  for (const plan of plans) {
    try {
      const year = new Date().getFullYear();
      const shipId = `SHP-${year}-${Math.floor(1000 + Math.random() * 9000)}`;

      const shipRow = {
        id: shipId,
        carrier: plan.carrier || '',
        mode: plan.mode || 'LTL',
        origin: plan.origin,
        dest: plan.destination,
        weight: plan.totalWeight || 0,
        pieces: plan.totalPieces || 0,
        status: 'Planned',
        total_cost: plan.totalCost || 0,
        rate: plan.rate || 0,
        fuel_surcharge: plan.fuelSurcharge || 0,
        accessorials: plan.accessorials || 0,
        order_ids: plan.orderIds || [],
        pickup_date: plan.pickupDate || null,
        delivery_date: plan.deliveryDate || null,
        czarlite_rate: !!plan.czarliteRate || (plan.mode || '').toUpperCase() === 'LTL',
        service_level: plan.serviceLevel || null,
        miles: plan.miles || null,
        rate_id: plan.rateId || null,
      };

      if (plan.dockDoor) shipRow.dock_door = plan.dockDoor;
      if (plan.dockTime) shipRow.dock_time = plan.dockTime;
      if (plan.loadingStart) shipRow.loading_start = plan.loadingStart;
      if (plan.loadingEnd) shipRow.loading_end = plan.loadingEnd;
      if (plan.dockIssue) shipRow.dock_issue = plan.dockIssue;

      const shipRes = await fetchImpl(`${SUPABASE_URL}/rest/v1/shipments?on_conflict=id`, {
        method: 'POST',
        headers: serviceHeaders(SERVICE_KEY, 'resolution=merge-duplicates,return=representation'),
        body: JSON.stringify(shipRow),
      });
      const shipData = await shipRes.json();

      if (!shipRes.ok && shipData?.message?.includes('dock_door')) {
        errors.push({ shipId, error: 'Dock columns missing in DB — run pending migrations' });
        continue;
      }
      if (!shipRes.ok) {
        errors.push({ shipId, error: shipData.message || 'DB insert failed' });
        continue;
      }

      const created = Array.isArray(shipData) ? shipData[0] : shipData;
      shipments.push(created);

      try {
        const bolId = `BOL-${shipId}`;
        const today = new Date().toISOString().split('T')[0];
        const orderIds = shipRow.order_ids || [];
        let allLines = [];
        let linkedOrders = [];

        for (const oid of orderIds) {
          try {
            const lines = await dbSelect('order_lines', `select=*&order_id=eq.${encodeURIComponent(oid)}&order=line_num.asc`, null);
            if (Array.isArray(lines)) allLines.push(...lines);
          } catch {}
          try {
            const ords = await dbSelect('orders', `select=*&id=eq.${encodeURIComponent(oid)}`, null);
            if (Array.isArray(ords) && ords.length) linkedOrders.push(ords[0]);
          } catch {}
        }

        const incoterms = linkedOrders.map((o) => o.incoterms).find(Boolean) || null;
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
        await fetchImpl(`${SUPABASE_URL}/rest/v1/shipments?id=eq.${encodeURIComponent(shipId)}`, {
          method: 'PATCH',
          headers: serviceHeaders(SERVICE_KEY, 'return=minimal'),
          body: JSON.stringify({ bol_number: bolId }),
        });
      } catch {}

      for (const orderId of plan.orderIds || []) {
        const ordPatchRes = await fetchImpl(`${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
          method: 'PATCH',
          headers: serviceHeaders(SERVICE_KEY, 'return=minimal'),
          body: JSON.stringify({ status: 'Planned', shipment_id: shipId }),
        });
        if (ordPatchRes.ok) ordersUpdated++;
        else errors.push({ orderId, error: `Order patch failed (${ordPatchRes.status})` });
      }
    } catch (planErr) {
      errors.push({ lane: plan.laneKey, error: planErr.message });
    }
  }

  return { shipments, ordersUpdated, errors };
}

module.exports = { executeBulkPlans };
