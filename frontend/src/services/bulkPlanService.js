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

import { BulkPlanApi, DbApi } from "../lib/api";
import { buildSingleOrderLane, buildLaneGroups } from "../utils/laneUtils";
// TMS bug #64: AI-driven plans need to populate dock_door / dock_time /
// loading_start / loading_end the same way the manual Plan flow does so
// the resulting shipment isn't half-empty in the UI. Reuse the shared
// dock assignment service rather than re-implementing the round-robin
// + occupancy logic here (CLAUDE_RULES §4 — services-first).
import { assignDockToPlan } from "./dockService";

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
    // Migration 025 — snapshot the rate's equipment onto the plan so
    // executePlan can persist it on the shipment. The rating engine
    // already echoes equipment back on every quote.
    equipment: bestQuote.equipment || null,
  };
}

/* ── Single-shipment planner (used by ZoreeAI / one-shot surfaces) ── */

/**
 * Plan a set of orders as ONE shipment using the same rating + executor
 * pipeline as the bulk planner. Guarantees the resulting shipment carries
 * the same cost detail (rate, fuel_surcharge, accessorials, service_level,
 * miles, rate_id, equipment, total_cost) as a regular Plan-Selected flow.
 *
 * @param {Object[]} orders                  — Order rows to plan together.
 * @param {Object}   [options]
 * @param {string}   [options.carrier]       — Preferred carrier (case-insensitive).
 *                                              Falls back to bestQuote when omitted
 *                                              or when the preferred carrier has
 *                                              no quote on this lane.
 * @param {string}   [options.optimizeBy="cost"]
 * @param {boolean}  [options.assignDock=true]
 *   TMS bug #64: when true (default) the planner auto-assigns a dock door
 *   + loading window using the shared dockService — same logic the manual
 *   confirmPlan flow runs. Pass `false` to preserve the legacy
 *   no-dock-fields behaviour.
 * @param {Array}    [options.existingShipments]
 *   Optional pre-fetched shipments to feed dock occupancy. If omitted,
 *   the service fetches via DbApi.shipments() so AI / single-shot
 *   callers don't need to plumb this through.
 * @param {Array}    [options.dockConfigs]
 *   Optional pre-fetched warehouse dock configs. Same fallback rules as
 *   existingShipments.
 * @returns {Promise<{ ok: boolean, errorMessage: string, shipment: Object|null, plan: Object|null }>}
 */
export async function planOrdersAsSingleShipment(orders, options = {}) {
  if (!Array.isArray(orders) || orders.length === 0) {
    return { ok: false, errorMessage: "No orders to plan", shipment: null, plan: null };
  }

  const lane = orders.length === 1
    ? buildSingleOrderLane(orders[0])
    : buildLaneGroups(orders)[0];
  if (!lane) {
    return { ok: false, errorMessage: "Could not build a lane from the supplied orders", shipment: null, plan: null };
  }

  // Rate the lane through the same engine the bulk planner uses.
  let result;
  try {
    const rateRes = await BulkPlanApi.rate([lane], options.optimizeBy || "cost");
    result = Array.isArray(rateRes?.results) ? rateRes.results[0] : null;
  } catch (err) {
    return { ok: false, errorMessage: `Rating failed: ${err?.message || err}`, shipment: null, plan: null };
  }
  if (!result) {
    return { ok: false, errorMessage: "Rating engine returned no result for this lane", shipment: null, plan: null };
  }

  const quotes = Array.isArray(result.quotes) ? result.quotes : [];
  const preferred = options.carrier ? String(options.carrier).trim().toLowerCase() : "";
  let chosenQuote = result.bestQuote || null;
  if (preferred) {
    const match = quotes.find((q) => String(q.carrier || "").trim().toLowerCase() === preferred);
    if (match) chosenQuote = match;
  }
  if (!chosenQuote) {
    return {
      ok: false,
      errorMessage: "No carrier rate available for this lane — configure a rate in Rate Management first",
      shipment: null,
      plan: null,
    };
  }
  // TMS bug #64: reject zero-cost quotes so a malformed rate row never
  // produces a "shipment created with $0 Est. Cost" surprise. The manual
  // Plan flow ignores these via the feasibility filter; the AI flow used
  // to silently accept them.
  if (!(Number(chosenQuote.totalCharge) > 0)) {
    return {
      ok: false,
      errorMessage: "Best quote returned $0 — the rate row is missing pricing. Plan failed before creating a shipment.",
      shipment: null,
      plan: null,
    };
  }

  const plan = buildPlan(lane, chosenQuote, orders);
  if (!plan) {
    return { ok: false, errorMessage: "Could not compute pickup/delivery dates for this lane", shipment: null, plan: null };
  }

  // TMS bug #64: assign a dock door + loading window so the resulting
  // shipment row carries dock_door / dock_time / loading_start /
  // loading_end. Without this the AI / single-shot path produced a
  // shipment with empty dock fields the manual flow always populates.
  // Failures here are non-fatal — the plan still executes (the dock can
  // be edited later) but we surface a console warning so we notice.
  if (options.assignDock !== false) {
    try {
      let { existingShipments, dockConfigs } = options;
      if (!Array.isArray(existingShipments)) {
        existingShipments = await DbApi.shipments().catch(() => []);
      }
      if (!Array.isArray(dockConfigs)) {
        dockConfigs = await DbApi.warehouseDockConfigs().catch(() => []);
      }
      assignDockToPlan(plan, {
        existingShipments,
        dockConfigs,
      });
    } catch (dockErr) {
      console.warn("[planOrdersAsSingleShipment] dock assignment failed:", dockErr?.message);
    }
  }

  // Execute via the same backend endpoint regular planning uses, so the
  // shipment row is built by api/services/bulkPlanExecution.js (single
  // source of truth — keeps cost columns, BOL doc, and order patches in
  // lockstep with bulk-plan results).
  let execRes;
  try {
    execRes = await BulkPlanApi.execute([plan]);
  } catch (err) {
    return { ok: false, errorMessage: `Shipment creation failed: ${err?.message || err}`, shipment: null, plan };
  }

  const shipments = Array.isArray(execRes?.shipments) ? execRes.shipments : [];
  const errors = Array.isArray(execRes?.errors) ? execRes.errors : [];
  if (shipments.length === 0) {
    return {
      ok: false,
      errorMessage: errors[0]?.error || "Backend did not return a shipment",
      shipment: null,
      plan,
    };
  }
  return { ok: true, errorMessage: "", shipment: shipments[0], plan };
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
