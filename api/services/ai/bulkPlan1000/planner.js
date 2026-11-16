// Deterministic Zoree side of the 1,000-order bulk plan: hard rules,
// consolidation, costing and candidate plans. No AI in this file.
'use strict';

const { CARRIERS } = require('./scenario');

const CAP = Object.freeze({ lbs: 44000, pallets: 26, stops: 3 });
const STOP_CHARGE = 75;
const LTL_MAX_LBS = 7500;

function checkOrder(o) {
  const errs = [];
  if (o.lbs > CAP.lbs) errs.push(`${o.lbs.toLocaleString()} lbs exceeds one 53' van`);
  if (o.plt > CAP.pallets) errs.push(`${o.plt} pallets exceeds ${CAP.pallets}`);
  return errs;
}

// First-fit decreasing within one cluster (same region, due day, equipment).
function packCluster(orders) {
  const loads = [];
  for (const o of [...orders].sort((a, b) => b.lbs - a.lbs)) {
    const fit = loads.find((l) => l.lbs + o.lbs <= CAP.lbs && l.plt + o.plt <= CAP.pallets
      && (l.dests.has(o.dest) || l.dests.size < CAP.stops));
    if (fit) { fit.orders.push(o); fit.lbs += o.lbs; fit.plt += o.plt; fit.dests.add(o.dest); }
    else loads.push({ orders: [o], lbs: o.lbs, plt: o.plt, dests: new Set([o.dest]) });
  }
  return loads.map((l) => ({ ...l, miles: Math.max(...l.orders.map((o) => o.miles)),
    penalty: l.orders.reduce((s, o) => s + o.penalty, 0) }));
}

function costFor(load, key) {
  const c = CARRIERS[key];
  if (c.kind === 'LTL') return Math.max(c.minCharge, Math.round((load.lbs / 100) * c.perCwt));
  return Math.round(c.baseFee + c.perMile * load.miles + STOP_CHARGE * (load.dests.size - 1));
}

function carriersFor(load, reefer) {
  if (reefer) return ['RF', 'RS'];
  const tl = ['CA', 'CB', 'CC'];
  return load.orders.length === 1 && load.lbs <= LTL_MAX_LBS ? [...tl, 'LTL'] : tl;
}

function assign(load, cluster, choose) {
  const options = carriersFor(load, cluster.reefer).map((k) => ({ k, cost: costFor(load, k), onTime: CARRIERS[k].onTime[cluster.region] }));
  const o = choose(options, load);
  return { orders: load.orders.map((x) => x.id), stops: [...load.dests], lbs: load.lbs, plt: load.plt,
    penalty: load.penalty, carrierKey: o.k, carrier: CARRIERS[o.k].name, onTime: o.onTime, cost: o.cost };
}

const cheapest = (opts) => opts.reduce((a, b) => (b.cost < a.cost ? b : a));
const mostReliable = (opts) => opts.reduce((a, b) => (b.onTime > a.onTime || (b.onTime === a.onTime && b.cost < a.cost) ? b : a));

function summarize(key, label, loads) {
  const atRisk = loads.filter((l) => l.penalty > 0 && l.onTime < 95);
  return { key, label, loads, trucks: loads.length, cost: loads.reduce((s, l) => s + l.cost, 0),
    minOnTime: Math.min(...loads.map((l) => l.onTime)),
    penaltyOnWeakCarriers: atRisk.reduce((s, l) => s + l.penalty, 0) };
}

// A = cheapest carrier everywhere; B = penalty loads to the most reliable
// carrier, rest cheapest; C = most reliable carrier everywhere.
function candidatePlans(cluster, packed) {
  return [
    summarize('A', 'Lowest cost', packed.map((l) => assign(l, cluster, cheapest))),
    summarize('B', 'Balanced', packed.map((l) => assign(l, cluster, l.penalty > 0 ? mostReliable : cheapest))),
    summarize('C', 'Most reliable', packed.map((l) => assign(l, cluster, mostReliable))),
  ];
}

function buildClusters(orders) {
  const rejected = [];
  const groups = new Map();
  for (const o of orders) {
    const errs = checkOrder(o);
    if (errs.length) { rejected.push({ order: o.id, dest: o.dest, errs }); continue; }
    const k = `${o.region}|${o.due}|${o.reefer ? 'Reefer' : 'Dry'}`;
    if (!groups.has(k)) groups.set(k, { key: k, region: o.region, due: o.due, reefer: o.reefer, orders: [] });
    groups.get(k).orders.push(o);
  }
  const clusters = [...groups.values()].map((c) => {
    const packed = packCluster(c.orders);
    return { ...c, orderCount: c.orders.length, plans: candidatePlans(c, packed) };
  });
  return { clusters, rejected };
}

module.exports = { CAP, buildClusters, packCluster, checkOrder };
