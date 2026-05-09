/**
 * Bulk Plan Service - progressive consolidation + splitting logic.
 * Port of frontend/src/services/bulkPlanService.js for React Native.
 */

import { BulkPlanApi } from '../../lib/api';
import { buildSingleOrderLane } from '../utils/laneUtils';

/* Date helpers */

function addBusinessDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
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
    return { pickup: null, delivery: null, transit: null, error: 'No transit time available' };
  }
  const minPickup = today > (readyDate || '') ? today : readyDate || today;
  let pickup = minPickup;
  if (dueDate) {
    const idealPickup = addBusinessDays(dueDate, -transit);
    if (idealPickup >= minPickup) pickup = idealPickup;
  }
  const delivery = addBusinessDays(pickup, transit);
  return { pickup, delivery, transit, error: null };
}

/* Rating helper */

// Bug #164: cache the TL trailer ceiling published by the server in
// `meta.equipment.tlMaxWeight`. Used by planLaneWithSplit to refuse a
// consolidated subset whose total weight wouldn't fit on a single
// trailer. The cache is populated on the first successful rate call
// and cleared at the start of each planAllLanes() run so admins
// editing Equipment Master see new ceilings on the next plan.
let _cachedTlMaxWeight = null;
export function _resetEquipmentLimitsCacheForTest() { _cachedTlMaxWeight = null; }
export function getCachedTlMaxWeight() { return _cachedTlMaxWeight; }

async function rateLane(lane, optimizeBy = 'cost') {
  try {
    const res = await BulkPlanApi.rate([lane], optimizeBy);
    // Capture the TL ceiling from server meta the first time we see it
    // so subsequent consolidation feasibility checks have a number to
    // compare against. Falsy values stay null and the consolidation
    // gate will skip (no number → no consolidation, the safer default).
    const tlMax = Number(res?.meta?.equipment?.tlMaxWeight);
    if (Number.isFinite(tlMax) && tlMax > 0) _cachedTlMaxWeight = tlMax;
    const results = Array.isArray(res?.results) ? res.results : [];
    const match = results.find((r) => r.laneKey === lane.laneKey);
    return match?.bestQuote || null;
  } catch {
    return null;
  }
}

/* Plan builder */

export function buildPlan(lane, bestQuote, laneOrders) {
  const readyDate = laneOrders
    .map((o) => o.readyDate || o.ready || o.pickup_date)
    .filter(Boolean)
    .sort()[0] || '';
  const dueDate = laneOrders
    .map((o) => o.dueDate || o.due || o.delivery_date)
    .filter(Boolean)
    .sort()
    .reverse()[0] || '';

  const dates = calcDates(bestQuote, dueDate, readyDate);
  if (dates.error) return null;

  return {
    laneKey: lane.laneKey,
    origin: lane.origin,
    destination: lane.destination,
    originZip: lane.originZip,
    destZip: lane.destZip,
    // REQ-24 + Mobile-bug 54: forward ship-from / ship-to names so
    // executePlan can persist them on the new shipment row.
    shipFromName: lane.shipFromName || '',
    shipToName:   lane.shipToName   || '',
    totalWeight: lane.totalWeight,
    totalPieces: lane.totalPieces,
    orderIds: lane.orderIds,
    carrier: bestQuote.carrier || '',
    mode: bestQuote.mode || 'LTL',
    totalCost: bestQuote.totalCharge || 0,
    // Mobile-bug 62: include rate/fuel/accessorials so the shipment
    // row is identical to web's. czarBaseGross = undiscounted base;
    // czarBase = discounted; fall back across the chain.
    rate:          bestQuote.czarBaseGross || bestQuote.czarBase || 0,
    fuelSurcharge: bestQuote.fscCharge || 0,
    accessorials:  bestQuote.accessorialCharge || 0,
    pickupDate: dates.pickup,
    deliveryDate: dates.delivery,
    transitDays: dates.transit,
    transitEstimated: bestQuote.transitEstimated || false,
    serviceLevel: bestQuote.serviceLevel || 'Standard',
    miles: bestQuote.pcmilerMiles || bestQuote.miles || null,
    czarliteRate: bestQuote.mode === 'LTL',
    rateId: bestQuote.rateId || null,
    // Migration 025 - snapshot the rate's equipment.
    equipment: bestQuote.equipment || null,
  };
}

/* Combinatorics */

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

/* Progressive consolidation */

export async function planLaneWithSplit(lane, laneOrders, allOrders, optimizeBy = 'cost') {
  const orderIds = lane.orderIds;

  if (orderIds.length === 1) {
    const quote = await rateLane(lane, optimizeBy);
    if (!quote) return { plans: [], consolidated: 0, individual: 0, failed: [orderIds[0]] };
    const plan = buildPlan(lane, quote, laneOrders);
    if (!plan) return { plans: [], consolidated: 0, individual: 0, failed: [orderIds[0]] };
    return { plans: [plan], consolidated: 0, individual: 1, failed: [] };
  }

  const individualQuotes = new Map();
  await Promise.all(
    laneOrders.map(async (order) => {
      const singleLane = buildSingleOrderLane(order);
      const quote = await rateLane(singleLane, optimizeBy);
      if (quote) {
        individualQuotes.set(order.id, { quote, cost: quote.totalCharge || 0 });
      }
    }),
  );

  for (let size = orderIds.length; size >= 2; size--) {
    const subsets = combinations(laneOrders, size);

    for (const subset of subsets) {
      const subsetIds = subset.map((o) => o.id);
      const consolidatedLane = {
        ...lane,
        totalWeight: subset.reduce((s, o) => s + Number(o.weight || 0), 0),
        totalPieces: subset.reduce((s, o) => s + Number(o.pieces || 0), 0),
        orderIds: subsetIds,
      };

      // Bug #164: refuse to consolidate a subset whose totalWeight
      // exceeds the TL trailer ceiling — this is the gate the original
      // algorithm was missing, which let 5×45,000 lb orders collapse
      // into one 225,000 lb shipment because consolidation was decided
      // on cost alone. The ceiling is sourced from the server's rate
      // response meta (equipment_types.DV53.max_weight). When the
      // server hasn't told us the ceiling yet we skip consolidation
      // (the safer default) — individual plans still produce.
      if (_cachedTlMaxWeight && consolidatedLane.totalWeight > _cachedTlMaxWeight) {
        continue;
      }

      const consolidatedQuote = await rateLane(consolidatedLane, optimizeBy);
      if (!consolidatedQuote) continue;

      const consolidatedCost = consolidatedQuote.totalCharge || 0;
      const individualSum = subsetIds.reduce((sum, id) => {
        const ind = individualQuotes.get(id);
        return sum + (ind ? ind.cost : Infinity);
      }, 0);

      if (consolidatedCost >= individualSum) continue;

      const consolidatedPlan = buildPlan(consolidatedLane, consolidatedQuote, subset);
      if (!consolidatedPlan) continue;

      const remainderOrders = laneOrders.filter((o) => !subsetIds.includes(o.id));
      const remainderPlans = [];
      const remainderFailed = [];

      for (const order of remainderOrders) {
        const ind = individualQuotes.get(order.id);
        if (ind) {
          const singleLane = buildSingleOrderLane(order);
          const plan = buildPlan(singleLane, ind.quote, [order]);
          if (plan) remainderPlans.push(plan);
          else remainderFailed.push(order.id);
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

  const individualPlans = [];
  const failed = [];

  for (const order of laneOrders) {
    const ind = individualQuotes.get(order.id);
    if (ind) {
      const singleLane = buildSingleOrderLane(order);
      const plan = buildPlan(singleLane, ind.quote, [order]);
      if (plan) individualPlans.push(plan);
      else failed.push(order.id);
    } else {
      failed.push(order.id);
    }
  }

  return { plans: individualPlans, consolidated: 0, individual: individualPlans.length, failed };
}

export async function planAllLanes(lanes, allOrders, optimizeBy = 'cost', onProgress) {
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

  return {
    plans: allPlans,
    totalConsolidated,
    totalIndividual,
    totalFailed: allFailed.length,
    failedOrderIds: allFailed,
  };
}
