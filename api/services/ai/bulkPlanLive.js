// Bulk plan on REAL data: 10 unplanned orders on one real lane, real
// current TL rates from the rates table. Zoree enforces hard rules and
// builds feasible plans; Jev chooses among feasible plans. Never tenders.
'use strict';

const jev = require('./jevClient');
const { isRateCurrent } = require('../rateMatcher');
const { SelectionError, resolveSelection, cityOf } = require('./bulkPlanSelection');
const { estimateLaneMiles } = require('../laneMiles');
const { estimateTransitDays } = require('../transitEstimate');

const ORIGIN = 'COLLEGE PARK, GA 30337';
const DEST = 'DALLAS, TX 75207';
const CAP_LBS = 44000;
const DEFAULT_MILES = 780; // College Park GA -> Dallas TX, used only if the rate row has no miles
const ORDER_COLS = 'id,customer,origin,dest,weight,pieces,ready,due,hazmat,no_consolidate,preferred_carrier,excluded_carrier,status';
const likeCity = (loc) => `%${cityOf(loc).replace(/[%_\\]/g, '')}%`;

function sb() {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);
}

function addDays(d, n) { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }

// First-fit decreasing by weight. Orders heavier than a truck are rejected.
function packLoads(orders) {
  const loads = [];
  for (const o of [...orders].sort((a, b) => b.weight - a.weight)) {
    const l = loads.find((x) => x.lbs + o.weight <= CAP_LBS);
    if (l) { l.orders.push(o); l.lbs += o.weight; } else loads.push({ orders: [o], lbs: o.weight });
  }
  return loads;
}

// rates table stores text like "$2.22" and "22.5%"
function num(v) { const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : 0; }

function loadCost(rate, miles) {
  const base = num(rate.rate) * miles;
  const fsc = base * num(rate.fsc) / 100;
  return Math.round(base + fsc);
}

const LANE_CONCURRENCY = 5;
const orderRow = (o) => ({ id: o.id, dest: o.dest, lbs: o.weight, plt: o.pieces, due: o.due, rule: o.weight > CAP_LBS ? 'Over one-truck capacity' : (o.customer || '') });

// Lanes to plan: the planner's selection from the Orders screen grouped by
// lane when order IDs are given, otherwise the default demo lane (10
// earliest-due unplanned orders).
async function loadLaneGroups(db, orderIds) {
  if (orderIds && orderIds.length) {
    const { data, error } = await db.from('orders').select(ORDER_COLS).in('id', orderIds);
    if (error) throw error;
    return resolveSelection(orderIds, data || []);
  }
  const { data, error } = await db.from('orders').select(ORDER_COLS)
    .eq('status', 'Unplanned').eq('origin', ORIGIN).eq('dest', DEST).gt('weight', 0)
    .order('due').limit(10);
  if (error) throw error;
  return { groups: [{ origin: ORIGIN, dest: DEST, orders: (data || []).map((o) => ({ ...o, weight: Number(o.weight) })) }], skipped: [] };
}

// One lane: Zoree packs and prices feasible plans, Jev chooses among them.
async function planLane(db, { orders, origin, dest, excludeCarrier = null }) {
  const lane = `${origin} -> ${dest}`;
  // Most rate rows carry no mileage. The default lane keeps its known 780 mi;
  // any other lane gets a ZIP-to-ZIP road-mile estimate (services/laneMiles).
  const isDefaultLane = origin === ORIGIN && dest === DEST;
  const estimatedMiles = isDefaultLane ? null : await estimateLaneMiles(db, origin, dest);
  const fallbackMiles = isDefaultLane ? DEFAULT_MILES : (estimatedMiles || 0);

  const { data: rateRows, error: rErr } = await db.from('rates')
    .select('carrier,mode,origin,dest,rate,unit,fsc,transit_days,status,eff,exp,miles')
    .ilike('origin', likeCity(origin)).ilike('dest', likeCity(dest)).eq('mode', 'TL');
  if (rErr) throw rErr;
  const rates = rateRows.filter((r) => String(r.status || '').toLowerCase() === 'active' && isRateCurrent(r)
    && (!excludeCarrier || r.carrier !== excludeCarrier));

  // Hard rules
  const rejected = [];
  const plannable = [];
  for (const o of orders) {
    if (o.weight > CAP_LBS) rejected.push({ orders: [o.id], errs: [`${o.weight.toLocaleString()} lbs exceeds one 53' van (${CAP_LBS.toLocaleString()} lbs)`] });
    else plannable.push(o);
  }
  if (!plannable.length) throw new SelectionError(`No order on ${lane} fits one 53' van (${CAP_LBS.toLocaleString()} lbs).`);
  const packed = packLoads(plannable);
  // Show one combination the packer refused (the two heaviest together), if it busts capacity.
  const heavy = [...plannable].sort((a, b) => b.weight - a.weight);
  if (heavy.length >= 2 && heavy[0].weight + heavy[1].weight > CAP_LBS) {
    rejected.push({ orders: [heavy[0].id, heavy[1].id], errs: [`${(heavy[0].weight + heavy[1].weight).toLocaleString()} lbs > ${CAP_LBS.toLocaleString()} capacity`] });
  }

  const earliestReady = plannable.map((o) => o.ready).sort()[0];
  const earliestDue = plannable.map((o) => o.due).sort()[0];

  const priced = rates.map((r) => {
    const miles = num(r.miles) || fallbackMiles;
    // No transit on the rate row: estimate it from distance, as the planner does.
    return { ...r, miles, milesEstimated: !num(r.miles) && !isDefaultLane, transit: num(r.transit_days) || estimateTransitDays({ miles, mode: 'TL' }) || 0 };
  }).filter((r) => num(r.rate) > 0 && r.miles > 0 && r.transit > 0);
  const cheapestOf = (list) => list.reduce((a, b) => (loadCost(b, b.miles) < loadCost(a, a.miles) ? b : a));
  const std = priced.filter((r) => r.transit >= 2);
  const fast = priced.filter((r) => r.transit > 0 && r.transit <= 2);
  const slowCheap = priced.length ? cheapestOf(priced) : null;
  const fastCheap = fast.length ? cheapestOf(fast) : null;

  function makePlan(key, label, loads, rate, note) {
    if (!rate) return null;
    const ls = loads.map((l) => ({
      orders: l.orders.map((o) => o.id), carrier: rate.carrier, cost: loadCost(rate, rate.miles),
      note: `${note} · ${rate.transit}-day transit · $${num(rate.rate)}/mi + ${num(rate.fsc)}% FSC · ${rate.miles} mi${rate.milesEstimated ? ' (est.)' : ''}`,
      lbs: l.lbs, plt: l.orders.reduce((s, o) => s + (Number(o.pieces) || 0), 0),
    }));
    const arrive = addDays(earliestReady, rate.transit);
    return { key, label, loads: ls, trucks: ls.length, cost: ls.reduce((s, l) => s + l.cost, 0), feasible: true,
      milesEstimated: !!rate.milesEstimated, carrier: rate.carrier, transit: rate.transit, arriveIfShipEarliest: arrive };
  }

  const plans = [
    makePlan('A', 'Consolidated · lowest cost', packed, slowCheap, 'consolidated'),
    makePlan('B', 'Consolidated · fastest', packed, fastCheap, 'consolidated'),
    makePlan('C', 'One truck per order', plannable.map((o) => ({ orders: [o], lbs: o.weight })), std.length ? cheapestOf(std) : slowCheap, 'direct'),
  ].filter(Boolean);
  // de-duplicate identical plans (e.g. same carrier chosen twice)
  const seen = new Set();
  const feasible = plans.filter((p) => { const k = `${p.carrier}|${p.trucks}`; if (seen.has(k)) return false; seen.add(k); return true; });
  if (!feasible.length) {
    throw new SelectionError(!rates.length
      ? `No active, in-date TL contract rate for ${lane}${excludeCarrier ? ` once ${excludeCarrier} is excluded` : ''}. Add a TL rate for this lane, then plan again.`
      : `${lane} has ${rates.length} TL contract rate${rates.length === 1 ? '' : 's'}, but none could be priced: the rate rows have no mileage and the distance could not be estimated from the order ZIP codes.`);
  }
  const cheapest = feasible.reduce((a, b) => (b.cost < a.cost ? b : a));

  const state = [
    `Bulk plan: ${plannable.length} unplanned orders from ${origin} to ${dest}. Earliest ready ${earliestReady}, earliest due ${earliestDue}.`,
    `Orders: ${plannable.map((o) => `${o.id} ${o.weight} lbs ready ${o.ready} due ${o.due}`).join('; ')}.`,
    excludeCarrier ? `${excludeCarrier} has no capacity today and is excluded.` : '',
    'All plans below already pass the 44,000 lb truck capacity rule.',
    ...feasible.map((p) => `Plan ${p.key} (${p.label}): ${p.trucks} trucks via ${p.carrier}, ${p.transit}-day transit, total $${p.cost}, earliest orders arrive ${p.arriveIfShipEarliest} vs earliest due ${earliestDue}.`),
  ].filter(Boolean).join('\n');

  const criteria = Object.fromEntries(feasible.map((p) => [p.key, `${p.label}: ${p.trucks} trucks, ${p.carrier}, $${p.cost}`]));
  const r = await jev.systemOne(state, {
    best_plan: { type: 'choice', instructions: 'Which feasible plan best balances total cost against on-time delivery risk for these orders', criteria },
    cheapest_puts_penalty_at_risk: { type: 'noul', instructions: `The cheapest plan (${cheapest.key}) risks delivering some orders after their due date` },
    cheapest_safe_to_autoplan: { type: 'noul', instructions: `The cheapest plan (${cheapest.key}) is safe to plan automatically without planner review` },
  });
  const a = r.answers;
  const pick = feasible.find((p) => p.key === a.best_plan.choice) || cheapest;
  const premium = pick.cost - cheapest.cost;
  const confidence = a.best_plan.confidence;
  const route = confidence >= 0.8 && premium <= 500 ? 'RECOMMEND_FOR_APPROVAL' : 'PLANNER_REVIEW';

  return {
    lane, capacity: { lbs: CAP_LBS },
    estimatedMiles: feasible.some((p) => p.milesEstimated) ? estimatedMiles : null,
    orders: orders.map(orderRow),
    rejected, plans: feasible,
    pick: pick.key, pickLabel: pick.label, cheapest: cheapest.key, premium, confidence, route,
    probabilities: a.best_plan.probabilities,
    penaltyRisk: a.cheapest_puts_penalty_at_risk?.noul, cheapestSafe: a.cheapest_safe_to_autoplan?.noul,
    affectedOrders: excludeCarrier ? plannable.map((o) => o.id) : [], excludedCarrier: excludeCarrier,
    latencyMs: r.latencyMs, model: r.model,
  };
}

// Plans every lane in the selection. A lane that cannot be planned (no rate,
// Jev unreachable) is returned with its error so the other lanes still show.
async function runBulkPlanLive({ excludeCarrier = null, orderIds = null } = {}) {
  const db = sb();
  const selected = !!(orderIds && orderIds.length);
  const { groups, skipped } = await loadLaneGroups(db, orderIds);
  const lanes = [];
  for (let i = 0; i < groups.length; i += LANE_CONCURRENCY) {
    lanes.push(...await Promise.all(groups.slice(i, i + LANE_CONCURRENCY).map((g) => planLane(db, { ...g, excludeCarrier })
      .catch((err) => ({ lane: `${g.origin} -> ${g.dest}`, orders: g.orders.map(orderRow), error: err.message })))));
  }
  return { live: true, selected, skipped, lanes };
}

module.exports = { runBulkPlanLive };
