// 1,000-order bulk plan: Zoree packs and prices (planner.js), Jev picks
// among feasible plans per lane cluster, policy routes each cluster to
// recommend-for-approval or planner review. Never tenders.
'use strict';

const jev = require('../jevClient');
const { ORIGIN, generateOrders } = require('./scenario');
const { CAP, buildClusters } = require('./planner');

const INPUT_COST_PER_TOKEN = 0.042 / 1_000_000; // TypeSafe list price
const MAX_PREMIUM = 500;
const MIN_CONFIDENCE = 0.8;
const CONCURRENCY = 6;

const signature = (p) => p.loads.map((l) => `${l.orders.join('+')}@${l.carrierKey}`).join('|');

function distinctPlans(plans) {
  const seen = new Set();
  return plans.filter((p) => { const s = signature(p); if (seen.has(s)) return false; seen.add(s); return true; });
}

function clusterState(c, plans) {
  const penaltyOrders = c.orders.filter((o) => o.penalty > 0);
  return [
    `Bulk plan from ${ORIGIN}: ${c.orderCount} ${c.reefer ? 'reefer' : 'dry'} orders to the ${c.region} region, due ${c.due}.`,
    penaltyOrders.length
      ? `${penaltyOrders.length} orders have delivery appointments with late penalties totaling $${penaltyOrders.reduce((s, o) => s + o.penalty, 0)}.`
      : 'No orders in this group carry late-delivery penalties.',
    'All plans below already pass truck capacity, pallet, equipment and stop-count rules.',
    ...plans.map((p) => `Plan ${p.key} (${p.label}): ${p.trucks} shipments, total $${p.cost}, lowest carrier on-time rate ${p.minOnTime}%, penalty dollars riding on carriers below 95% on-time: $${p.penaltyOnWeakCarriers}.`),
  ].join('\n');
}

async function judgeCluster(c) {
  const plans = distinctPlans(c.plans);
  const cheapest = plans.reduce((a, b) => (b.cost < a.cost ? b : a));
  const base = { key: c.key, region: c.region, due: c.due, equipment: c.reefer ? 'Reefer' : 'Dry', orders: c.orderCount, plans };
  if (plans.length === 1) {
    return { ...base, pick: cheapest.key, cheapest: cheapest.key, premium: 0, confidence: 1, route: 'RECOMMEND_FOR_APPROVAL', jev: false, reason: 'one feasible plan, no trade-off' };
  }
  const criteria = Object.fromEntries(plans.map((p) => [p.key, `${p.label}: ${p.trucks} shipments, $${p.cost}`]));
  const r = await jev.systemOne(clusterState(c, plans), {
    best_plan: { type: 'choice', instructions: 'Which feasible plan best balances total cost against on-time delivery risk and late penalties', criteria },
    cheapest_safe_to_autoplan: { type: 'noul', instructions: `The cheapest plan (${cheapest.key}) is safe to plan automatically without planner review` },
  }, { config: { timeoutMs: 8000 } });
  const a = r.answers;
  const pick = plans.find((p) => p.key === a.best_plan.choice) || cheapest;
  const premium = pick.cost - cheapest.cost;
  const confidence = a.best_plan.confidence;
  const route = confidence >= MIN_CONFIDENCE && premium <= MAX_PREMIUM ? 'RECOMMEND_FOR_APPROVAL' : 'PLANNER_REVIEW';
  return { ...base, pick: pick.key, cheapest: cheapest.key, premium, confidence, route, jev: true,
    probabilities: a.best_plan.probabilities, cheapestSafe: a.cheapest_safe_to_autoplan?.noul,
    latencyMs: r.latencyMs, tokens: r.usage?.input_tokens || 0, model: r.model };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

async function runBulkPlan1000({ count = 1000, seed } = {}) {
  const started = Date.now();
  const orders = generateOrders(count, seed);
  const { clusters, rejected } = buildClusters(orders);
  const results = await mapLimit(clusters, CONCURRENCY, judgeCluster);
  const picked = results.map((r) => r.plans.find((p) => p.key === r.pick));
  const cheapestPlans = results.map((r) => r.plans.find((p) => p.key === r.cheapest));
  const jevCalls = results.filter((r) => r.jev);
  const tokens = jevCalls.reduce((s, r) => s + r.tokens, 0);
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  return {
    scenario: 'synthetic', origin: ORIGIN, capacity: CAP,
    totals: {
      orders: orders.length,
      planned: orders.length - rejected.length,
      rejected: rejected.length,
      naiveTrucks: orders.length - rejected.length,
      trucks: sum(picked, (p) => p.trucks),
      ltl: sum(picked, (p) => p.loads.filter((l) => l.carrierKey === 'LTL').length),
      clusters: results.length,
      jevCalls: jevCalls.length,
      recommend: results.filter((r) => r.route === 'RECOMMEND_FOR_APPROVAL').length,
      review: results.filter((r) => r.route === 'PLANNER_REVIEW').length,
      cheapestCost: sum(cheapestPlans, (p) => p.cost),
      pickedCost: sum(picked, (p) => p.cost),
      penaltyExposedCheapest: sum(cheapestPlans, (p) => p.penaltyOnWeakCarriers),
      penaltyExposedPicked: sum(picked, (p) => p.penaltyOnWeakCarriers),
      jevLatencyMsAvg: jevCalls.length ? Math.round(sum(jevCalls, (r) => r.latencyMs) / jevCalls.length) : 0,
      jevTokens: tokens,
      jevCostUsd: +(tokens * INPUT_COST_PER_TOKEN).toFixed(4),
      wallClockMs: Date.now() - started,
      model: jevCalls[0]?.model || null,
    },
    rejected, clusters: results,
  };
}

module.exports = { runBulkPlan1000 };
