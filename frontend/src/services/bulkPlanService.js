/**
 * Bulk Plan Service — progressive consolidation + splitting logic.
 *
 * Core idea:
 *   1. Rate all orders individually to get baseline costs.
 *   2. Try consolidating all orders in a lane group.
 *   3. Only consolidate if consolidated cost < sum of individual costs.
 *   4. If consolidation fails or is more expensive, try smaller subsets.
 *   5. Always maximize the largest group that is both rate-able AND cheaper.
 */

import { BulkPlanApi } from "../lib/api";
import { buildSingleOrderLane } from "../utils/laneUtils";

/* ── Date helpers ── */

function addBusinessDays(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00");
  const step = days >= 0 ? 1 : -1;
  let remaining = Math.abs(days);
  while (remaining > 0) {
    d.setDate(d.getDate() + step);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return d.toISOString().slice(0, 10);
}

export function calcDates(quote, dueDate, readyDate) {
  const today = new Date().toISOString().slice(0, 10);
  const transit = quote.transitDays || null;
  if (!transit) {
    return { pickup: null, delivery: null, transit: null, error: "No transit time available" };
  }
  const minPickup = today > (readyDate || "") ? today : (readyDate || today);
  let pickup = minPickup;
  if (dueDate) {
    const idealPickup = addBusinessDays(dueDate, -transit);
    if (idealPickup >= minPickup) pickup = idealPickup;
  }
  const delivery = addBusinessDays(pickup, transit);
  return { pickup, delivery, transit, error: null };
}

/* ── Rating helper ── */

/**
 * Rate a single lane and return the bestQuote, or null if no valid quote.
 */
async function rateLane(lane, optimizeBy = "cost") {
  try {
    const res = await BulkPlanApi.rate([lane], optimizeBy);
    const results = Array.isArray(res?.results) ? res.results : [];
    const match = results.find((r) => r.laneKey === lane.laneKey);
    return match?.bestQuote || null;
  } catch {
    return null;
  }
}

/* ── Plan builder ── */

/**
 * Build an execution plan from a lane + bestQuote + orders.
 * Returns the plan object or null if dates can't be calculated.
 */
export function buildPlan(lane, bestQuote, laneOrders) {
  const readyDate = laneOrders
    .map((o) => o.ready || o.pickup_date)
    .filter(Boolean)
    .sort()[0] || "";
  const dueDate = laneOrders
    .map((o) => o.due || o.delivery_date)
    .filter(Boolean)
    .sort()
    .reverse()[0] || "";

  const dates = calcDates(bestQuote, dueDate, readyDate);
  if (dates.error) return null;

  return {
    laneKey: lane.laneKey,
    origin: lane.origin,
    destination: lane.destination,
    originZip: lane.originZip,
    destZip: lane.destZip,
    // REQ-24: forward the lane's ship-from / ship-to Location Name into the
    // plan so `executePlan` can persist it on the new shipment row.
    shipFromName: lane.shipFromName || "",
    shipToName:   lane.shipToName   || "",
    totalWeight: lane.totalWeight,
    totalPieces: lane.totalPieces,
    orderIds: lane.orderIds,
    carrier: bestQuote.carrier || "",
    mode: bestQuote.mode || "LTL",
    totalCost: bestQuote.totalCharge || 0,
    // Bug fix paired with REQ-31: without these three lines, shipments
    // created via Plan Group / Plan Selected landed with rate=0,
    // fuel_surcharge=0, accessorials=0 on the row even when the chosen
    // quote had non-zero components. OrdersPage.jsx confirmPlan already
    // forwarded these; buildPlan now matches so every planning surface
    // writes consistent values to the shipment row.
    //   - czarBaseGross = undiscounted CzarLite base (LTL) or rpm*miles (TL)
    //   - czarBase      = discounted base; fall back if Gross missing
    //   - fscCharge / accessorialCharge default to 0 when absent
    rate:          bestQuote.czarBaseGross || bestQuote.czarBase || 0,
    fuelSurcharge: bestQuote.fscCharge || 0,
    accessorials:  bestQuote.accessorialCharge || 0,
    pickupDate: dates.pickup,
    deliveryDate: dates.delivery,
    transitDays: dates.transit,
    transitEstimated: bestQuote.transitEstimated || false,
    serviceLevel: bestQuote.serviceLevel || "Standard",
    miles: bestQuote.pcmilerMiles || bestQuote.miles || null,
    czarliteRate: bestQuote.mode === "LTL",
    rateId: bestQuote.rateId || null,
  };
}

/* ── Progressive consolidation ── */

/**
 * Generate all subsets of size k from an array (combinations).
 */
function combinations(arr, k) {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  const result = [];
  function recurse(start, combo) {
    if (combo.length === k) { result.push([...combo]); return; }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      recurse(i + 1, combo);
      combo.pop();
    }
  }
  recurse(0, []);
  return result;
}

/**
 * Plan a lane group with progressive splitting and cost validation.
 *
 * @param {Object} lane - The consolidated lane object
 * @param {Object[]} laneOrders - The order objects in this lane
 * @param {Object[]} allOrders - All orders (for lookups)
 * @param {string} optimizeBy - "cost" or "transit"
 * @returns {Object} { plans: Plan[], consolidated: number, individual: number, failed: string[] }
 */
export async function planLaneWithSplit(lane, laneOrders, allOrders, optimizeBy = "cost") {
  const orderIds = lane.orderIds;

  // If only 1 order, no consolidation possible — just rate and plan it
  if (orderIds.length === 1) {
    const quote = await rateLane(lane, optimizeBy);
    if (!quote) return { plans: [], consolidated: 0, individual: 0, failed: [orderIds[0]] };
    const plan = buildPlan(lane, quote, laneOrders);
    if (!plan) return { plans: [], consolidated: 0, individual: 0, failed: [orderIds[0]] };
    return { plans: [plan], consolidated: 0, individual: 1, failed: [] };
  }

  // Step 1: Rate each order individually to get baseline costs
  const individualQuotes = new Map(); // orderId → { quote, cost }
  await Promise.all(
    laneOrders.map(async (order) => {
      const singleLane = buildSingleOrderLane(order);
      const quote = await rateLane(singleLane, optimizeBy);
      if (quote) {
        individualQuotes.set(order.id, { quote, cost: quote.totalCharge || 0 });
      }
    })
  );

  // Step 2: Try consolidated groups from largest to smallest
  // Start with all orders, then try N-1 subsets, etc.
  for (let size = orderIds.length; size >= 2; size--) {
    const subsets = combinations(laneOrders, size);

    for (const subset of subsets) {
      const subsetIds = subset.map((o) => o.id);

      // Build a consolidated lane for this subset
      const consolidatedLane = {
        ...lane,
        laneKey: lane.laneKey,
        totalWeight: subset.reduce((s, o) => s + Number(o.weight || 0), 0),
        totalPieces: subset.reduce((s, o) => s + Number(o.pieces || 0), 0),
        orderIds: subsetIds,
      };

      const consolidatedQuote = await rateLane(consolidatedLane, optimizeBy);
      if (!consolidatedQuote) continue; // Can't rate this subset — skip

      const consolidatedCost = consolidatedQuote.totalCharge || 0;

      // Sum individual costs for orders in this subset
      const individualSum = subsetIds.reduce((sum, id) => {
        const ind = individualQuotes.get(id);
        return sum + (ind ? ind.cost : Infinity);
      }, 0);

      // Only consolidate if cheaper than shipping individually
      if (consolidatedCost >= individualSum) continue;

      // Build the consolidated plan
      const consolidatedPlan = buildPlan(consolidatedLane, consolidatedQuote, subset);
      if (!consolidatedPlan) continue;

      // Handle remainder orders (not in this subset)
      const remainderOrders = laneOrders.filter((o) => !subsetIds.includes(o.id));
      const remainderPlans = [];
      const remainderFailed = [];

      for (const order of remainderOrders) {
        const ind = individualQuotes.get(order.id);
        if (ind) {
          const singleLane = buildSingleOrderLane(order);
          const plan = buildPlan(singleLane, ind.quote, [order]);
          if (plan) {
            remainderPlans.push(plan);
          } else {
            remainderFailed.push(order.id);
          }
        } else {
          remainderFailed.push(order.id);
        }
      }

      return {
        plans: [consolidatedPlan, ...remainderPlans],
        consolidated: subsetIds.length,
        individual: remainderPlans.length,
        failed: remainderFailed,
      };
    }
  }

  // Step 3: No consolidation was cost-effective — plan all individually
  const individualPlans = [];
  const failed = [];

  for (const order of laneOrders) {
    const ind = individualQuotes.get(order.id);
    if (ind) {
      const singleLane = buildSingleOrderLane(order);
      const plan = buildPlan(singleLane, ind.quote, [order]);
      if (plan) {
        individualPlans.push(plan);
      } else {
        failed.push(order.id);
      }
    } else {
      failed.push(order.id);
    }
  }

  return {
    plans: individualPlans,
    consolidated: 0,
    individual: individualPlans.length,
    failed,
  };
}

/**
 * Plan all lane groups with progressive splitting.
 *
 * @param {Object[]} lanes - Lane group objects
 * @param {Object[]} allOrders - All orders for lookups
 * @param {string} optimizeBy - "cost" or "transit"
 * @param {function} onProgress - Callback for status updates (optional)
 * @returns {Object} { plans, totalConsolidated, totalIndividual, totalFailed, failedOrderIds }
 */
export async function planAllLanes(lanes, allOrders, optimizeBy = "cost", onProgress) {
  let allPlans = [];
  let totalConsolidated = 0;
  let totalIndividual = 0;
  let allFailed = [];

  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i];
    if (onProgress) onProgress(`Rating lane ${i + 1}/${lanes.length}: ${lane.laneKey}`);

    const laneOrders = lane.orderIds
      .map((id) => allOrders.find((o) => o.id === id))
      .filter(Boolean);

    const result = await planLaneWithSplit(lane, laneOrders, allOrders, optimizeBy);
    allPlans = allPlans.concat(result.plans);
    totalConsolidated += result.consolidated;
    totalIndividual += result.individual;
    allFailed = allFailed.concat(result.failed);
  }

  return { plans: allPlans, totalConsolidated, totalIndividual, totalFailed: allFailed.length, failedOrderIds: allFailed };
}
