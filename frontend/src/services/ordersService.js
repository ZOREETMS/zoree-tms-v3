/**
 * Business logic / API functions extracted from OrdersPage.
 * Pure service layer — no React state, no toasts, no UI side-effects.
 */

import { DbApi, OrdersApi, BulkPlanApi, MileageApi } from "../lib/api";
import { addBusinessDays } from "../utils/orderUtils.jsx";

/* ── Internal helper: generate a shipment ID ── */
function genShipId() {
  return `SHP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

/**
 * Create shipments (MBOL + CBOLs) from a multi-stop route template.
 * Returns { masterShipment, childShipments, ordersUpdated, routePath, error }.
 */
export async function createShipmentsFromRoute(route, ordersList, rates = []) {
  const normalize = (s) => (s || "").trim().toLowerCase().split(",")[0].trim();
  const stops = Array.isArray(route.stops) ? route.stops : [];
  const pickups = stops.filter((s) => s.type === "pickup");
  const deliveries = stops.filter((s) => s.type === "delivery");
  const firstPickup = pickups[0] || stops[0];
  const lastDelivery = deliveries[deliveries.length - 1] || stops[stops.length - 1];
  const totalCost = parseFloat(route.cost_override) || 0;
  const totalMiles = parseFloat(route.total_miles) || 0;

  // Auto-assign orders to delivery stops by matching destination
  const assignments = {};
  for (const d of deliveries) {
    const dCity = normalize(d.location || d.city);
    const matched = ordersList.filter((o) => {
      const oCity = normalize(o.dest);
      return oCity.includes(dCity) || dCity.includes(oCity);
    });
    if (matched.length > 0) {
      const key = `${(firstPickup.stop_seq || 1)}.${d.stop_seq || d.sequence}`;
      assignments[key] = { delivery: d, orders: matched };
    }
  }

  if (Object.keys(assignments).length === 0) {
    return { masterShipment: null, childShipments: [], ordersUpdated: 0, routePath: "", error: "Could not match orders to route stops" };
  }

  const masterId = genShipId();
  const allOrderIds = ordersList.map((o) => o.id);
  const today = new Date().toISOString().slice(0, 10);
  const dueDates = ordersList.map((o) => o.due).filter(Boolean).sort();
  const routeTransitDays = parseInt(route.transit_days) || 2;
  // Delivery = earliest due date (must arrive by then)
  const deliveryDate = dueDates[0] || addBusinessDays(today, routeTransitDays);
  // Pickup = delivery - transit days (work backwards)
  let pickupDate = addBusinessDays(deliveryDate, -routeTransitDays);
  // If pickup is in the past, use today instead
  if (pickupDate < today) pickupDate = today;

  // Create MBOL
  const masterShipment = {
    id: masterId, carrier: route.carrier, mode: route.mode || "TL",
    origin: firstPickup.location || `${firstPickup.city}, ${firstPickup.state}`,
    dest: lastDelivery.location || `${lastDelivery.city}, ${lastDelivery.state}`,
    weight: ordersList.reduce((s, o) => s + (parseFloat(o.weight) || 0), 0),
    pieces: ordersList.reduce((s, o) => s + (parseInt(o.pieces) || 0), 0),
    status: "Planned", total_cost: totalCost, order_ids: allOrderIds,
    miles: totalMiles, bol_type: "MBOL", route_template_id: route.id,
    pickup_date: pickupDate, delivery_date: deliveryDate,
    service_level: route.service_level || "Standard",
  };
  await DbApi.upsert("shipments", masterShipment);

  // Create CBOLs and update orders
  // Calculate leg miles from stops, or fetch via PC*Miler
  const cbolKeys = Object.keys(assignments);
  let totalLegMiles = 0;
  const cbolMilesMap = {};
  for (const [key, { delivery }] of Object.entries(assignments)) {
    const pIdx = stops.indexOf(firstPickup);
    const dIdx = stops.indexOf(delivery);
    let miles = 0;
    for (let i = pIdx + 1; i <= dIdx; i++) miles += parseFloat(stops[i].leg_miles) || 0;
    cbolMilesMap[key] = miles;
    totalLegMiles += miles;
  }
  // If no leg miles on stops, fetch from PC*Miler
  if (totalLegMiles === 0 && cbolKeys.length > 0) {
    try {
      const pairs = Object.entries(assignments).map(([, { delivery }]) => ({
        origin: firstPickup.location || `${firstPickup.city}, ${firstPickup.state}`,
        dest: delivery.location || `${delivery.city}, ${delivery.state}`,
      }));
      const mileageRes = await MileageApi.bulk(pairs);
      const results = Array.isArray(mileageRes?.results) ? mileageRes.results : (Array.isArray(mileageRes) ? mileageRes : []);
      cbolKeys.forEach((key, idx) => {
        const mi = parseFloat(results[idx]?.miles || results[idx]?.distance) || 0;
        cbolMilesMap[key] = mi;
        totalLegMiles += mi;
      });
    } catch { /* PC*Miler unavailable — fall through to equal split */ }
  }
  // If still 0, split cost equally
  const equalSplit = totalLegMiles === 0;

  const createdCbols = [];
  for (const [key, { delivery, orders: cbolOrders }] of Object.entries(assignments)) {
    const childId = `${masterId}.${key}`;
    const legMiles = cbolMilesMap[key] || 0;
    const cbolCost = equalSplit
      ? Math.round((totalCost / cbolKeys.length) * 100) / 100
      : Math.round((legMiles / totalLegMiles) * totalCost * 100) / 100;

    const cbolOrigin = firstPickup.location || `${firstPickup.city}, ${firstPickup.state}`;
    const cbolDest = delivery.location || `${delivery.city}, ${delivery.state}`;
    // Look up rate ID by matching carrier + origin + dest
    const carrierNorm = normalize(route.carrier);
    const oNorm = normalize(cbolOrigin);
    const dNorm = normalize(cbolDest);
    const matchedRate = rates.find((r) => {
      const rc = normalize(r.carrier);
      const ro = normalize(r.origin);
      const rd = normalize(r.dest || r.destination);
      return (rc.includes(carrierNorm) || carrierNorm.includes(rc)) &&
             (ro.includes(oNorm) || oNorm.includes(ro)) &&
             (rd.includes(dNorm) || dNorm.includes(rd));
    });

    await DbApi.upsert("shipments", {
      id: childId, carrier: route.carrier, mode: route.mode || "TL",
      origin: cbolOrigin, dest: cbolDest,
      weight: cbolOrders.reduce((s, o) => s + (parseFloat(o.weight) || 0), 0),
      pieces: cbolOrders.reduce((s, o) => s + (parseInt(o.pieces) || 0), 0),
      status: "Planned", total_cost: cbolCost, order_ids: cbolOrders.map((o) => o.id),
      miles: legMiles, bol_type: "CBOL", master_shipment_id: masterId,
      stop_from: key.split(".")[0], stop_to: key.split(".")[1],
      route_template_id: route.id,
      pickup_date: pickupDate, delivery_date: deliveryDate,
      service_level: route.service_level || "Standard",
      rate_id: matchedRate ? (matchedRate.lane || matchedRate.id) : null,
    });
    createdCbols.push({ id: childId, origin: cbolOrigin, dest: cbolDest, cost: cbolCost, miles: legMiles, orders: cbolOrders });

    for (const ord of cbolOrders) {
      await DbApi.patch("orders", ord.id, { status: "Planned", shipment_id: childId });
    }
  }

  // Build full route path from stops
  const routePath = stops.map((s) => (s.city || (s.location || "").split(",")[0] || "").trim()).filter(Boolean).join(" \u2192 ");

  return {
    masterShipment: { ...masterShipment, routePath },
    childShipments: createdCbols,
    ordersUpdated: ordersList.length,
    routePath,
    error: null,
  };
}

/**
 * Unplan an order and clean up its shipment cascade (CBOL -> MBOL).
 * Returns { message, deletedShipments }.
 */
export async function unplanOrderFromShipment(id, orders, shipments) {
  const deletedShipments = [];
  const order = orders.find((o) => o.id === id);
  const shipmentId = order?.shipment_id;
  await DbApi.patch("orders", id, { status: "Unplanned", shipment_id: null });

  let message = `Order ${id} unplanned`;

  // Clean up shipment if no orders remain
  if (shipmentId) {
    const remainingOrders = orders.filter((o) => o.shipment_id === shipmentId && o.id !== id);
    if (remainingOrders.length === 0) {
      // Delete the shipment (and its master if this was the last CBOL)
      const ship = shipments.find((s) => s.id === shipmentId);
      await DbApi.remove("shipments", shipmentId).catch(() => {});
      deletedShipments.push(shipmentId);
      // If it was a CBOL, check if the MBOL has any remaining CBOLs
      if (ship?.master_shipment_id) {
        const siblingCbols = shipments.filter((s) => s.master_shipment_id === ship.master_shipment_id && s.id !== shipmentId);
        if (siblingCbols.length === 0) {
          await DbApi.remove("shipments", ship.master_shipment_id).catch(() => {});
          deletedShipments.push(ship.master_shipment_id);
          message = `Order ${id} unplanned. Shipment ${shipmentId} and master ${ship.master_shipment_id} deleted.`;
        } else {
          message = `Order ${id} unplanned. Shipment ${shipmentId} deleted.`;
        }
      } else {
        message = `Order ${id} unplanned. Shipment ${shipmentId} deleted.`;
      }
    }
  }

  return { message, deletedShipments };
}

/**
 * Execute a set of plans via the BulkPlanApi.
 */
export async function executeSinglePlan(plans) {
  return await BulkPlanApi.execute(plans);
}

/**
 * Fetch carrier quotes for a lane, sorted: feasible (on-time) first, then by cost ascending.
 * @param {object}   lane         - Lane object with origin, dest, weights, etc.
 * @param {function} calcDatesFn  - Function(quote, dueDate, readyDate) => { warning, ... }
 * @param {string}   dueDate      - Earliest due date (ISO string)
 * @param {string}   readyDate    - Latest ready date (ISO string)
 */
export async function fetchCarrierQuotes(lane, calcDatesFn, dueDate, readyDate) {
  const rateRes = await BulkPlanApi.rate([lane], "cost");
  const results = Array.isArray(rateRes?.results) ? rateRes.results : [];
  const rawQuotes = results[0]?.quotes || [];
  const bestQuote = results[0]?.bestQuote || null;

  // Sort: feasible (on-time) first, then by cost ascending
  const sortedQuotes = [...rawQuotes].sort((a, b) => {
    if (calcDatesFn) {
      const datesA = calcDatesFn(a, dueDate, readyDate);
      const datesB = calcDatesFn(b, dueDate, readyDate);
      const lateA = datesA.warning ? 1 : 0;
      const lateB = datesB.warning ? 1 : 0;
      if (lateA !== lateB) return lateA - lateB; // on-time first
    }
    return (a.totalCharge || 0) - (b.totalCharge || 0); // then cheapest
  });

  return { quotes: sortedQuotes, bestQuote };
}

/**
 * Get order ready/due date helpers.
 */
function getOrderReady(o) {
  return o.ready || o.pickup_date || o.ready_date || null;
}
function getOrderDue(o) {
  return o.due || o.delivery_date || o.due_date || null;
}

/**
 * Check if a group of orders can ship together given actual transit days.
 * Returns true if latest ready + transit days <= earliest due.
 * @param {Object[]} orders - orders in the group
 * @param {number} transitDays - actual transit days from carrier (CarrierConnect or rates table)
 */
export function datesCompatibleWithTransit(orders, transitDays) {
  if (!transitDays || orders.length <= 1) return true;

  const readyDates = orders.map(getOrderReady).filter(Boolean);
  const dueDates = orders.map(getOrderDue).filter(Boolean);
  if (!readyDates.length || !dueDates.length) return true;

  const latestReady = readyDates.sort().reverse()[0];
  const earliestDue = dueDates.sort()[0];

  const estDelivery = addBusinessDays(latestReady, transitDays);
  const ok = estDelivery <= earliestDue;

  if (!ok) {
    console.log(`[datesCompatible] INCOMPATIBLE: latestReady=${latestReady} + ${transitDays}d transit → delivery=${estDelivery} > earliestDue=${earliestDue}`);
  }
  return ok;
}

/**
 * Split orders into groups that fit under a weight limit.
 * Uses first-fit decreasing bin packing.
 * Date compatibility is checked AFTER rating when actual transit is known.
 */
export function splitOrdersByWeight(orders, maxWeight = 15000) {
  const sorted = [...orders].sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0));
  const bins = [];

  for (const order of sorted) {
    const w = Number(order.weight || 0);
    let placed = false;
    for (const bin of bins) {
      if (bin.weight + w <= maxWeight) {
        bin.orders.push(order);
        bin.weight += w;
        placed = true;
        break;
      }
    }
    if (!placed) {
      bins.push({ orders: [order], weight: w });
    }
  }

  return bins.map((b) => b.orders);
}

/**
 * Build shipment groups from orders — split by weight limit.
 * Date compatibility is checked AFTER rating when actual carrier transit days are known.
 * Returns array of { lane, orders } objects.
 */
export function buildShipmentGroups(orders, baseLane, maxWeight = 15000) {
  const totalWeight = orders.reduce((s, o) => s + Number(o.weight || 0), 0);

  // If total fits under limit, return single group
  if (totalWeight <= maxWeight) {
    return [{ lane: baseLane, orders }];
  }

  // Split into groups by weight only
  const groups = splitOrdersByWeight(orders, maxWeight);
  console.log(`[buildShipmentGroups] totalWeight=${totalWeight} → ${groups.length} groups by weight`);
  return groups.map((groupOrders) => {
    const groupWeight = groupOrders.reduce((s, o) => s + Number(o.weight || 0), 0);
    const groupPieces = groupOrders.reduce((s, o) => s + Number(o.pieces || 0), 0);
    return {
      lane: {
        ...baseLane,
        totalWeight: groupWeight,
        totalPieces: groupPieces,
        orderIds: groupOrders.map((o) => o.id),
      },
      orders: groupOrders,
    };
  });
}

/**
 * Bulk-plan all unplanned orders: same logic as Plan Group.
 * 1. Group by lane
 * 2. Group by equipment weight (TL max if over LTL)
 * 3. Rate each group
 * 4. Check date compatibility with actual transit
 * 5. Split incompatible orders and re-rate individually
 * 6. Execute plans
 * Returns { created, updated, cost, noQuotes, shipments, plans }.
 */
export async function bulkPlanOrders(unplannedOrders) {
  if (!unplannedOrders.length) {
    return { created: 0, updated: 0, cost: 0, noQuotes: true };
  }

  const LTL_MAX = 15000;
  const TL_MAX = 44000;
  const { calcDates } = await import("./bulkPlanService.js");

  // Group by lane
  const normLane = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const laneMap = {};
  unplannedOrders.forEach((o) => {
    const key = `${normLane(o.origin)}||${normLane(o.dest)}`;
    if (!laneMap[key]) laneMap[key] = [];
    laneMap[key].push(o);
  });

  const allPlans = [];

  for (const laneOrders of Object.values(laneMap)) {
    const o = laneOrders[0];
    const totalWeight = laneOrders.reduce((s, x) => s + Number(x.weight || 0), 0);
    const originZip = String(o.origin_zip || o.origin || "").match(/\b(\d{5})\b/)?.[1] || "";
    const destZip = String(o.dest_zip || o.dest || "").match(/\b(\d{5})\b/)?.[1] || "";

    // Use equipment max weight (TL if over LTL) — same as Plan Group
    const equipMaxWeight = totalWeight <= LTL_MAX ? LTL_MAX : TL_MAX;
    const groups = buildShipmentGroups(laneOrders, {
      laneKey: `${o.origin || ""} -> ${o.dest || ""}`, origin: o.origin || "", destination: o.dest || "",
      originZip, destZip, freightClass: o.freight_class || "70",
      totalWeight, totalPieces: laneOrders.reduce((s, x) => s + Number(x.pieces || 0), 0),
      orderIds: laneOrders.map((x) => x.id),
    }, equipMaxWeight);

    // Rate each group
    for (const sg of groups) {
      const readyD = sg.orders.map((s) => s.ready).filter(Boolean).sort().reverse()[0] || "";
      const dueD = sg.orders.map((s) => s.due).filter(Boolean).sort()[0] || "";
      const { quotes, bestQuote } = await fetchCarrierQuotes(sg.lane, calcDates, dueD, readyD);

      if (!bestQuote) continue;

      const transit = bestQuote.transitDays;

      // Check date compatibility with actual transit — same as Plan Group
      if (sg.orders.length > 1 && transit && !datesCompatibleWithTransit(sg.orders, transit)) {
        // Find best compatible subset — same logic as Plan Group
        const sorted = [...sg.orders].sort((a, b) =>
          (a.due || a.delivery_date || "9999").localeCompare(b.due || b.delivery_date || "9999")
        );

        let bestSubset = null;
        for (let size = sorted.length - 1; size >= 2; size--) {
          for (let skip = 0; skip < sorted.length; skip++) {
            const subset = sorted.filter((_, idx) => idx !== skip);
            if (subset.length === size && datesCompatibleWithTransit(subset, transit)) {
              bestSubset = subset;
              break;
            }
          }
          if (bestSubset) break;
        }

        if (bestSubset) {
          // Rate consolidated subset
          const subsetWeight = bestSubset.reduce((s, x) => s + Number(x.weight || 0), 0);
          const subsetLane = { ...sg.lane, totalWeight: subsetWeight, totalPieces: bestSubset.reduce((s, x) => s + Number(x.pieces || 0), 0), orderIds: bestSubset.map(x => x.id) };
          const subReadyD = bestSubset.map(s => s.ready).filter(Boolean).sort().reverse()[0] || "";
          const subDueD = bestSubset.map(s => s.due).filter(Boolean).sort()[0] || "";
          const { bestQuote: subBest } = await fetchCarrierQuotes(subsetLane, calcDates, subDueD, subReadyD);
          if (subBest) {
            const dates = calcDates(subBest, subDueD, subReadyD);
            if (!dates.error) {
              allPlans.push({
                laneKey: subsetLane.laneKey, origin: subsetLane.origin, destination: subsetLane.destination,
                originZip: subsetLane.originZip, destZip: subsetLane.destZip,
                totalWeight: subsetLane.totalWeight, totalPieces: subsetLane.totalPieces, orderIds: subsetLane.orderIds,
                carrier: subBest.carrier || "", mode: subBest.mode || "LTL",
                totalCost: subBest.totalCharge || 0, pickupDate: dates.pickup, deliveryDate: dates.delivery,
                czarliteRate: subBest.mode === "LTL", serviceLevel: subBest.serviceLevel || "Standard",
                miles: subBest.miles || null, rateId: subBest.rateId || null,
              });
            }
          }

          // Rate remainder individually
          const remainder = sg.orders.filter(x => !bestSubset.some(s => s.id === x.id));
          for (const order of remainder) {
            const singleLane = { ...sg.lane, totalWeight: Number(order.weight || 0), totalPieces: Number(order.pieces || 0), orderIds: [order.id] };
            const { bestQuote: indBest } = await fetchCarrierQuotes(singleLane, calcDates, order.due || "", order.ready || "");
            if (indBest) {
              const dates = calcDates(indBest, order.due || "", order.ready || "");
              if (!dates.error) {
                allPlans.push({
                  laneKey: singleLane.laneKey, origin: singleLane.origin, destination: singleLane.destination,
                  originZip: singleLane.originZip, destZip: singleLane.destZip,
                  totalWeight: singleLane.totalWeight, totalPieces: singleLane.totalPieces, orderIds: [order.id],
                  carrier: indBest.carrier || "", mode: indBest.mode || "LTL",
                  totalCost: indBest.totalCharge || 0, pickupDate: dates.pickup, deliveryDate: dates.delivery,
                  czarliteRate: indBest.mode === "LTL", serviceLevel: indBest.serviceLevel || "Standard",
                  miles: indBest.miles || null, rateId: indBest.rateId || null,
                });
              }
            }
          }
        } else {
          // No compatible subset — plan all individually
          for (const order of sg.orders) {
            const singleLane = { ...sg.lane, totalWeight: Number(order.weight || 0), totalPieces: Number(order.pieces || 0), orderIds: [order.id] };
            const { bestQuote: indBest } = await fetchCarrierQuotes(singleLane, calcDates, order.due || "", order.ready || "");
            if (indBest) {
              const dates = calcDates(indBest, order.due || "", order.ready || "");
              if (!dates.error) {
                allPlans.push({
                  laneKey: singleLane.laneKey, origin: singleLane.origin, destination: singleLane.destination,
                  originZip: singleLane.originZip, destZip: singleLane.destZip,
                  totalWeight: singleLane.totalWeight, totalPieces: singleLane.totalPieces, orderIds: [order.id],
                  carrier: indBest.carrier || "", mode: indBest.mode || "LTL",
                  totalCost: indBest.totalCharge || 0, pickupDate: dates.pickup, deliveryDate: dates.delivery,
                  czarliteRate: indBest.mode === "LTL", serviceLevel: indBest.serviceLevel || "Standard",
                  miles: indBest.miles || null, rateId: indBest.rateId || null,
                });
              }
            }
          }
        }
      } else {
        // Dates compatible or single order — plan as-is
        const dates = calcDates(bestQuote, dueD, readyD);
        if (!dates.error) {
          allPlans.push({
            laneKey: sg.lane.laneKey, origin: sg.lane.origin, destination: sg.lane.destination,
            originZip: sg.lane.originZip, destZip: sg.lane.destZip,
            totalWeight: sg.lane.totalWeight, totalPieces: sg.lane.totalPieces, orderIds: sg.lane.orderIds,
            carrier: bestQuote.carrier || "", mode: bestQuote.mode || "LTL",
            totalCost: bestQuote.totalCharge || 0, pickupDate: dates.pickup, deliveryDate: dates.delivery,
            czarliteRate: bestQuote.mode === "LTL", serviceLevel: bestQuote.serviceLevel || "Standard",
            miles: bestQuote.miles || null, rateId: bestQuote.rateId || null,
          });
        }
      }
    }
  }

  if (!allPlans.length) {
    return { created: 0, updated: 0, cost: 0, noQuotes: true };
  }

  try {
    const execRes = await BulkPlanApi.execute(allPlans);
    const shipments = execRes?.shipments || [];
    return {
      created: shipments.length,
      updated: execRes?.ordersUpdated || 0,
      cost: shipments.reduce((s, sh) => s + Number(sh.total_cost || 0), 0),
      shipments, plans: allPlans, noQuotes: false,
    };
  } catch (err) {
    throw err;
  }
}

/**
 * Find a route template whose pickup/delivery stops match the orders' origins/dests.
 * Returns { route, matchedOrders } or null if no template matches 2+ orders.
 */
export function findMatchingRoute(templates, orders) {
  const normalize = (s) => (s || "").trim().toLowerCase().split(",")[0].trim();

  for (const t of templates) {
    if (!t.carrier) continue;
    const tStops = Array.isArray(t.stops) ? t.stops : [];
    const tPickups = tStops.filter((s) => s.type === "pickup").map((s) => normalize(s.location || s.city));
    const tDeliveries = tStops.filter((s) => s.type === "delivery").map((s) => normalize(s.location || s.city));

    // Find orders that match this route (origin matches a pickup, dest matches a delivery)
    const matched = orders.filter((o) => {
      const oOrigin = normalize(o.origin);
      const oDest = normalize(o.dest);
      return tPickups.some((p) => oOrigin.includes(p) || p.includes(oOrigin))
        && tDeliveries.some((td) => oDest.includes(td) || td.includes(oDest));
    });

    // Only use multi-stop route if matched orders have 2+ different destinations
    const uniqueDests = new Set(matched.map((o) => normalize(o.dest)));
    if (matched.length >= 2 && uniqueDests.size >= 2) {
      return { route: t, matchedOrders: matched };
    }
  }

  return null;
}
