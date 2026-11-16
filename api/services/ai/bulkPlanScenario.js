// Bulk-plan demo: Zoree enforces hard rules and builds feasible plans for a
// 10-order scenario; Jev chooses among the feasible plans. Never tenders.
'use strict';

const jev = require('./jevClient');

const CAP = { lbs: 44000, pallets: 26 };

const ORDERS = [
  { id: 'O1', dest: 'Houston', lbs: 12000, plt: 8, due: 'Tue' },
  { id: 'O2', dest: 'Houston', lbs: 9000, plt: 6, due: 'Tue' },
  { id: 'O3', dest: 'Houston', lbs: 14000, plt: 10, due: 'Wed' },
  { id: 'O4', dest: 'Austin', lbs: 8000, plt: 6, due: 'Tue' },
  { id: 'O5', dest: 'San Antonio', lbs: 10000, plt: 7, due: 'Tue' },
  { id: 'O6', dest: 'San Antonio', lbs: 11000, plt: 8, due: 'Tue', rule: '8am appointment, $500 late penalty' },
  { id: 'O7', dest: 'Oklahoma City', lbs: 16000, plt: 12, due: 'Tue' },
  { id: 'O8', dest: 'Tulsa', lbs: 9000, plt: 6, due: 'Wed' },
  { id: 'O9', dest: 'Shreveport', lbs: 7000, plt: 5, due: 'Tue', rule: 'Reefer required', reefer: true },
  { id: 'O10', dest: 'Shreveport', lbs: 6000, plt: 4, due: 'Wed' },
];

const CARRIERS = {
  KLLM: { name: 'KLLM', onTime: 96, note: 'cheapest' },
  WERNER: { name: 'Werner', onTime: 99, note: '+7% vs KLLM' },
  SCHNEIDER: { name: 'Schneider', onTime: 91, note: 'declined 2 of last 5 San Antonio tenders' },
  LTL: { name: 'LTL (Estes)', onTime: 94, note: 'LTL' },
  REEFER_LTL: { name: 'Reefer LTL', onTime: 95, note: 'reefer' },
};

// Candidate loads: [orderIds, carrierKey, cost, stopNote]
const PLANS_ALL = {
  A: { label: 'Lowest cost', loads: [
    [['O1', 'O2', 'O3'], 'KLLM', 1850, 'Houston consolidated'],
    [['O4', 'O5', 'O6'], 'SCHNEIDER', 1990, 'Austin -> San Antonio multi-stop; O6 is last stop'],
    [['O7', 'O8'], 'KLLM', 1620, 'OKC -> Tulsa'],
    [['O9'], 'REEFER_LTL', 780, 'reefer LTL'],
    [['O10'], 'LTL', 600, 'LTL'],
  ] },
  B: { label: 'Balanced', loads: [
    [['O1', 'O2', 'O3'], 'KLLM', 1850, 'Houston consolidated'],
    [['O4'], 'LTL', 540, 'LTL'],
    [['O5', 'O6'], 'WERNER', 1830, 'San Antonio direct, O6 first stop'],
    [['O7', 'O8'], 'KLLM', 1620, 'OKC -> Tulsa'],
    [['O9'], 'REEFER_LTL', 780, 'reefer LTL'],
    [['O10'], 'LTL', 600, 'LTL'],
  ] },
  C: { label: 'All direct', loads: [
    [['O1', 'O2'], 'KLLM', 1400, 'Houston Tue'],
    [['O3'], 'KLLM', 1150, 'Houston Wed'],
    [['O4'], 'WERNER', 980, 'Austin direct'],
    [['O5', 'O6'], 'WERNER', 1830, 'San Antonio direct'],
    [['O7'], 'KLLM', 1180, 'OKC direct'],
    [['O8'], 'WERNER', 830, 'Tulsa direct'],
    [['O9'], 'REEFER_LTL', 780, 'reefer LTL'],
    [['O10'], 'LTL', 600, 'LTL'],
  ] },
  // KLLM unavailable: Zoree regenerates without KLLM
  A2: { label: 'Lowest cost (no KLLM)', loads: [
    [['O1', 'O2', 'O3'], 'SCHNEIDER', 1920, 'Houston consolidated'],
    [['O4', 'O5', 'O6'], 'SCHNEIDER', 1990, 'Austin -> San Antonio multi-stop; O6 is last stop'],
    [['O7', 'O8'], 'SCHNEIDER', 1690, 'OKC -> Tulsa'],
    [['O9'], 'REEFER_LTL', 780, 'reefer LTL'],
    [['O10'], 'LTL', 600, 'LTL'],
  ] },
  B2: { label: 'Balanced (no KLLM)', loads: [
    [['O1', 'O2', 'O3'], 'WERNER', 1980, 'Houston consolidated'],
    [['O4'], 'LTL', 540, 'LTL'],
    [['O5', 'O6'], 'WERNER', 1830, 'San Antonio direct, O6 first stop'],
    [['O7', 'O8'], 'SCHNEIDER', 1690, 'OKC -> Tulsa (no decline history on this lane)'],
    [['O9'], 'REEFER_LTL', 780, 'reefer LTL'],
    [['O10'], 'LTL', 600, 'LTL'],
  ] },
  C2: { label: 'All direct (no KLLM)', loads: [
    [['O1', 'O2'], 'WERNER', 1500, 'Houston Tue'],
    [['O3'], 'WERNER', 1230, 'Houston Wed'],
    [['O4'], 'WERNER', 980, 'Austin direct'],
    [['O5', 'O6'], 'WERNER', 1830, 'San Antonio direct'],
    [['O7'], 'SCHNEIDER', 1210, 'OKC direct'],
    [['O8'], 'WERNER', 830, 'Tulsa direct'],
    [['O9'], 'REEFER_LTL', 780, 'reefer LTL'],
    [['O10'], 'LTL', 600, 'LTL'],
  ] },
};

// Combinations Zoree tried and rejected on hard rules.
const TRIED = [
  { orders: ['O1', 'O2', 'O3', 'O4'], why: null },
  { orders: ['O9', 'O10'], why: null },
  { orders: ['O5', 'O6', 'O7'], why: null },
];

const byId = Object.fromEntries(ORDERS.map((o) => [o.id, o]));

function checkLoad(ids) {
  const os = ids.map((i) => byId[i]);
  const lbs = os.reduce((s, o) => s + o.lbs, 0);
  const plt = os.reduce((s, o) => s + o.plt, 0);
  const errs = [];
  if (lbs > CAP.lbs) errs.push(`${lbs.toLocaleString()} lbs > ${CAP.lbs.toLocaleString()}`);
  if (plt > CAP.pallets) errs.push(`${plt} pallets > ${CAP.pallets}`);
  if (os.some((o) => o.reefer) && os.some((o) => !o.reefer)) errs.push('reefer freight cannot share a dry van');
  const dests = new Set(os.map((o) => o.dest));
  const region = (d) => ({ Houston: 'SE', Austin: 'S', 'San Antonio': 'S', 'Oklahoma City': 'N', Tulsa: 'N', Shreveport: 'E' }[d]);
  if (new Set([...dests].map(region)).size > 1) errs.push('stops in different directions from Dallas');
  return { lbs, plt, ok: errs.length === 0, errs };
}

function buildPlan(key, kllmOut) {
  const p = PLANS_ALL[key];
  const loads = p.loads.map(([ids, carrier, cost, note]) => {
    const chk = checkLoad(ids);
    return { orders: ids, carrier: CARRIERS[carrier].name, carrierKey: carrier, cost, note, lbs: chk.lbs, plt: chk.plt, ok: chk.ok && !(kllmOut && carrier === 'KLLM'), errs: chk.errs };
  });
  const covered = new Set(loads.flatMap((l) => l.orders));
  const feasible = loads.every((l) => l.ok) && ORDERS.every((o) => covered.has(o.id));
  return { key, label: p.label, loads, trucks: loads.length, cost: loads.reduce((s, l) => s + l.cost, 0), feasible };
}

function planText(p) {
  return `${p.key} (${p.label}), total $${p.cost}: ` + p.loads.map((l) =>
    `[${l.orders.join('+')} via ${l.carrier} (${CARRIERS[l.carrierKey].onTime}% on-time${CARRIERS[l.carrierKey].note.includes('declined') ? ', ' + CARRIERS[l.carrierKey].note : ''}), ${l.note}]`).join('; ');
}

async function runBulkPlan({ kllmUnavailable = false } = {}) {
  const keys = kllmUnavailable ? ['A2', 'B2', 'C2'] : ['A', 'B', 'C'];
  const plans = keys.map((k) => buildPlan(k, kllmUnavailable));
  const feasible = plans.filter((p) => p.feasible);
  const rejected = TRIED.map((t) => ({ orders: t.orders, errs: checkLoad(t.orders).errs }));
  const cheapest = feasible.reduce((a, b) => (b.cost < a.cost ? b : a));

  const state = [
    'Freight bulk plan from Dallas DC, one pickup day. All plans below already pass capacity, equipment and due-date rules.',
    'Customer rule: order O6 (San Antonio) has an 8am delivery appointment with a $500 late penalty.',
    kllmUnavailable ? 'KLLM has no capacity today, so plans exclude KLLM.' : '',
    'Feasible plans:',
    ...feasible.map(planText),
  ].filter(Boolean).join('\n');

  const criteria = Object.fromEntries(feasible.map((p) => [p.key, `${p.label}, $${p.cost}, ${p.trucks} shipments`]));
  const r = await jev.systemOne(state, {
    best_plan: { type: 'choice', instructions: 'Which feasible plan best balances total cost against service risk and penalties', criteria },
    cheapest_puts_penalty_at_risk: { type: 'noul', instructions: `The cheapest plan (${cheapest.key}) puts the penalty-bearing O6 appointment at risk` },
    cheapest_safe_to_autoplan: { type: 'noul', instructions: `The cheapest plan (${cheapest.key}) is safe to plan automatically without a planner reviewing it` },
  });
  const a = r.answers;
  const pick = feasible.find((p) => p.key === a.best_plan.choice) || cheapest;
  const premium = pick.cost - cheapest.cost;
  const confidence = a.best_plan.confidence;
  const route = confidence >= 0.8 && premium <= 500 ? 'RECOMMEND_FOR_APPROVAL' : 'PLANNER_REVIEW';
  const affected = kllmUnavailable
    ? [...new Set(PLANS_ALL.B.loads.filter((l) => l[1] === 'KLLM').flatMap((l) => l[0]))]
    : [];

  return {
    orders: ORDERS, capacity: CAP, rejected, plans,
    pick: pick.key, pickLabel: pick.label, cheapest: cheapest.key, premium, confidence, route,
    probabilities: a.best_plan.probabilities,
    penaltyRisk: a.cheapest_puts_penalty_at_risk?.noul,
    cheapestSafe: a.cheapest_safe_to_autoplan?.noul,
    affectedOrders: affected, kllmUnavailable,
    latencyMs: r.latencyMs, model: r.model,
  };
}

module.exports = { runBulkPlan, ORDERS };
