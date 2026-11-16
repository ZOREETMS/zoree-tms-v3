#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// Zoree quantum engine benchmark — scripts/quantum/benchmark.js
// ─────────────────────────────────────────────────────────────────────
// Runs every in-process sampler on the same synthetic batches and prints,
// per batch, the savings each one reaches on its own (before the
// per-bucket greedy fallback) and the time it took:
//   greedy   classical savings-merge baseline (+ same polish)
//   SA       simulated annealing           (sampler 'local')
//   SB       simulated bifurcation         (sampler 'sb', quantum-inspired)
//   exact    proven optimum over the candidate loads (sampler 'exact')
//   gap      how far SA / SB are below the exact result
// If SA and SB both sit at 0.00% gap, the problem is easy at this size and
// no sampler — classical, quantum-inspired or quantum — can add savings.
//
// Synthetic data only (Midwest/South lanes, 2k–18k lb, 12 lb/cu ft,
// 2–4 day windows). For real numbers run /api/quantum/plan/consolidate
// on live orders with optimalityGap: true.
//
//   node scripts/quantum/benchmark.js            # default sizes
//   node scripts/quantum/benchmark.js 60 120 300 # custom sizes
// ═══════════════════════════════════════════════════════════════════

'use strict';

const path = require('path');
const api = path.join(__dirname, '..', '..', 'api');
const engine = require(path.join(api, 'services', 'quantumLocal'));
const { mulberry32 } = require(path.join(api, 'services', 'quantumLocal', 'annealer'));
const { regionForState } = require(path.join(api, 'constants', 'usRegions'));

const ORIG = [['IL', 41.88, -87.63], ['IL', 41.53, -88.08], ['IN', 41.59, -87.35], ['WI', 43.04, -87.91],
  ['TX', 32.78, -96.80], ['TX', 32.75, -97.33], ['GA', 33.75, -84.39]];
const DEST = [['MI', 42.33, -83.05], ['OH', 41.65, -83.54], ['OH', 39.96, -83.0], ['IN', 39.77, -86.16],
  ['TX', 29.76, -95.37], ['TN', 35.15, -90.05], ['TN', 36.16, -86.78], ['NC', 35.23, -80.84]];

function synthetic(n, seed) {
  const r = mulberry32(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const day0 = Date.parse('2026-11-10T08:00:00Z');
  const shipments = [];
  const windows = {};
  for (let i = 0; i < n; i++) {
    const o = pick(ORIG), d = pick(DEST);
    const w = Math.round(2000 + r() * 16000);
    const ready = day0 + Math.floor(r() * 3) * 86400000;
    const due = ready + (2 + Math.floor(r() * 3)) * 86400000;
    shipments.push({
      id: `S${i + 1}`, origin_region: regionForState(o[0]), destination_region: regionForState(d[0]),
      distance_miles: 0, weight_lbs: w, volume_cuft: +(w / 12).toFixed(1), origin_city: '', destination_city: '',
      origin_lat: o[1], origin_lon: o[2], destination_lat: d[1], destination_lon: d[2], sla_hours: (due - ready) / 3600000,
    });
    windows[`S${i + 1}`] = { ready: new Date(ready).toISOString(), due: new Date(due).toISOString() };
  }
  const carriers = [
    { id: 'C1', name: 'TL A', base_fee: 150, rate_per_mile: 2.35, weight_cap_lbs: 45000, volume_cap_cuft: 3800, transit_multiplier: 1, reliability: 0.96 },
    { id: 'C2', name: 'TL B', base_fee: 100, rate_per_mile: 2.55, weight_cap_lbs: 45000, volume_cap_cuft: 3800, transit_multiplier: 1.05, reliability: 0.93 },
    { id: 'L1', name: 'LTL', base_fee: 0, rate_per_mile: 4.0, weight_cap_lbs: 20000, volume_cap_cuft: 2000, transit_multiplier: 1.3, reliability: 0.9 },
  ];
  const lanes = [...new Set(shipments.map((s) => `${s.origin_region}|${s.destination_region}`))];
  const rate_table = lanes.map((k) => {
    const [a, b] = k.split('|');
    return { carrier_id: 'L1', origin_region: a, destination_region: b, rate_per_lb: 0.075, rate_per_cuft: 0, minimum_charge: 250 };
  });
  return { payload: { shipments, carriers, rate_table }, windows };
}

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

const pct = (a, b) => (b > 0 ? `${(((b - a) / b) * 100).toFixed(2)}%` : '0.00%');

async function run(payload, windows, sampler) {
  const t0 = Date.now();
  const r = await engine.optimizeConsolidate(payload, { windows, seed: 1, sampler });
  return { r, ms: Date.now() - t0 };
}

async function main() {
  const sizes = process.argv.slice(2).map(Number).filter((n) => n > 0);
  const runs = sizes.length ? sizes.map((n, i) => [n, 7 + i]) : [[60, 7], [120, 7], [120, 11], [200, 3], [300, 5]];
  console.log('ships seed  greedy     SA         SB         exact      SA gap  SB gap  exact proven   ms SA/SB/exact');
  for (const [n, seed] of runs) {
    const { payload, windows } = synthetic(n, seed);
    const sa = await run(payload, windows, 'local');
    const sb = await run(payload, windows, 'sb');
    const ex = await run(payload, windows, 'exact');
    const g = sa.r.benchmark.greedy_savings;
    const opt = ex.r.benchmark.qubo_savings;
    const o = ex.r.benchmark.optimality;
    console.log(
      `${String(n).padEnd(5)} ${String(seed).padEnd(5)} ${money(g).padEnd(10)} ${money(sa.r.benchmark.qubo_savings).padEnd(10)} ` +
      `${money(sb.r.benchmark.qubo_savings).padEnd(10)} ${money(opt).padEnd(10)} ` +
      `${pct(sa.r.benchmark.qubo_savings, opt).padEnd(7)} ${pct(sb.r.benchmark.qubo_savings, opt).padEnd(7)} ` +
      `${`${o.buckets_proven}/${o.buckets_solved} buckets`.padEnd(14)} ${sa.ms}/${sb.ms}/${ex.ms}`
    );
  }
}

if (require.main === module) main();

module.exports = { synthetic };
