#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// Quantum engine end-to-end run — api/scripts/quantumRun.js
// ─────────────────────────────────────────────────────────────────────
// One command: build the payload from live Zoree data, send it to the
// Otodus engine exactly as its manual documents, re-validate what comes
// back, and leave every artifact on disk.
//
//   node api/scripts/quantumRun.js --limit 100 --density 12
//   node api/scripts/quantumRun.js --ids TEST-QE-M0103-01,TEST-QE-M0103-02
//   node api/scripts/quantumRun.js --limit 100 --density 12 --dry
//
// Flags
//   --limit N        orders to pull (default 100)
//   --ids A,B,C      explicit order ids; overrides --limit
//   --prefix STR     only orders whose id starts with STR (e.g. TEST-QE)
//   --density N      lb/cu ft used to estimate missing volume. REQUIRED
//                    whenever orders carry no volume_cuft, which today is
//                    all of them. 12 matches DV53 (45,000 lb / 3,800 cuft).
//   --task X         consolidate (default) | rates
//   --allow CODES    comma-separated preflight rule codes to ignore
//   --out-dir DIR    artifact directory (default ./quantum-runs/<stamp>)
//   --dry            build and validate the payload, send nothing
//   --force          send even when a readiness blocker is present
//
// Environment (api/.env)
//   QUANTUM_ENGINE_URL      default http://localhost:8000
//   QUANTUM_ENGINE_API_KEY  the vendor's key. Required unless --dry.
//
// The transport is services/quantumEngine.js — the same client the API
// routes use — so this script and the app cannot drift apart on headers,
// error shapes or base URL.
//
// The key is read from the environment and never written to an artifact
// or logged. Set it in api/.env or export it for the one run.
//
// Exit codes: 0 ok · 1 blocked before sending · 2 engine/transport error
// ═══════════════════════════════════════════════════════════════════

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { dbSelect } = require('../services/supabase');
const zipGeo = require('../services/zipGeo');
const mapper = require('../services/quantumEngineMapper');
const { preflightOrders } = require('../services/quantumPreflight');
const engine = require('../services/quantumEngine');

const ENGINE_URL = (process.env.QUANTUM_ENGINE_URL || 'http://localhost:8000').replace(/\/+$/, '');
const API_KEY = process.env.QUANTUM_ENGINE_API_KEY || '';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback;
}
function flag(name) { return process.argv.includes(`--${name}`); }
function money(n) { return `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function pct(n, d) { return d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a'; }
function tally(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = String(r[key]).replace(/\s+\S*\d\S*$/, '').trim();
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
const line = (s = '') => console.log(s);
const rule = (c = '─') => line(c.repeat(70));

(async () => {
  const limit = Number(arg('limit', 100));
  const ids = (arg('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const prefix = arg('prefix');
  const density = Number(arg('density', 0)) || undefined;
  const task = (arg('task', 'consolidate') || 'consolidate').toLowerCase();
  const allow = (arg('allow') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const dry = flag('dry');
  const force = flag('force');

  if (!['consolidate', 'rates'].includes(task)) {
    console.error(`--task must be 'consolidate' or 'rates', got '${task}'`);
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = arg('out-dir') || path.join(process.cwd(), 'quantum-runs', stamp);
  fs.mkdirSync(outDir, { recursive: true });

  rule('═');
  line(`QUANTUM RUN  ${stamp}`);
  line(`task ${task}  ·  engine ${ENGINE_URL}  ·  ${dry ? 'DRY (nothing is sent)' : 'LIVE'}`);
  rule('═');

  // ── 1. Load ────────────────────────────────────────────────────────
  await zipGeo.load();
  line(`zip_geo          ${zipGeo.size()} zips cached`);

  const [allOrders, carriers, rates, shipments, equipment] = await Promise.all([
    dbSelect('orders', { limit: ids.length ? 5000 : Math.max(limit * 5, 500) }),
    dbSelect('carriers', {}),
    dbSelect('rates', { limit: 20000 }),
    dbSelect('shipments', { limit: 5000 }),
    dbSelect('equipment_types', {}),
  ]);

  let orders = allOrders;
  if (ids.length) {
    const want = new Set(ids);
    orders = orders.filter((o) => want.has(o.id));
    const missing = ids.filter((i) => !orders.some((o) => o.id === i));
    if (missing.length) line(`WARNING          ${missing.length} requested id(s) not found: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`);
  } else {
    if (prefix) orders = orders.filter((o) => String(o.id).startsWith(prefix));
    orders = orders.slice(0, limit);
  }
  line(`orders pulled    ${orders.length}`);

  // ── 2. Preflight: constraints the engine cannot see ────────────────
  const pre = preflightOrders(orders, { allow });
  line(`\nPREFLIGHT        ${pre.eligible.length}/${orders.length} eligible (${pct(pre.eligible.length, orders.length)})`);
  for (const [code, n] of Object.entries(pre.counts).sort((a, b) => b[1] - a[1])) {
    line(`   excluded ${String(n).padStart(4)}  ${code}`);
  }
  if (allow.length) line(`   (rules deliberately ignored: ${allow.join(', ')})`);

  // ── 3. Map to the engine's schema ──────────────────────────────────
  const milesByOrderId = new Map();
  for (const s of shipments) {
    if (!s.miles || !Array.isArray(s.order_ids)) continue;
    for (const oid of s.order_ids) if (!milesByOrderId.has(oid)) milesByOrderId.set(oid, Number(s.miles));
  }
  const byCode = new Map(equipment.map((e) => [String(e.code).toUpperCase(), e]));
  const capsByCarrierId = new Map();
  for (const c of carriers) {
    const eq = byCode.get(String(c.mode).toUpperCase() === 'LTL' ? 'LTL' : 'DV53');
    if (eq) capsByCarrierId.set(c.id, { max_weight: Number(eq.max_weight), max_volume: Number(eq.max_volume) });
  }

  const S = mapper.toEngineShipments(pre.eligible, {
    resolveGeo: zipGeo.resolveGeo, milesByOrderId, assumedDensityLbPerCuft: density,
  });
  const C = mapper.toEngineCarriers(carriers, { capsByCarrierId });
  const R = mapper.toEngineRateTable(rates, { regionOf: zipGeo.regionOf });

  line(`\nSHIPMENTS        ${S.shipments.length}/${pre.eligible.length} mapped (${pct(S.shipments.length, pre.eligible.length)})`);
  for (const [reason, n] of tally(S.skipped, 'reason')) line(`   skipped ${String(n).padStart(5)}  ${reason}`);
  if (S.meta.estimated.length) {
    line(`   NOTE: ${S.meta.estimated.length} shipment(s) carry an ESTIMATED volume at ${density} lb/cu ft, not a measured one.`);
  }
  line(`CARRIERS         ${C.carriers.length}/${carriers.length} mapped`);
  for (const [reason, n] of tally(C.skipped, 'reason')) line(`   skipped ${String(n).padStart(5)}  ${reason}`);
  line(`RATE TABLE       ${R.rate_table.length}/${rates.length} mapped`);
  for (const [reason, n] of tally(R.skipped, 'reason').slice(0, 6)) line(`   skipped ${String(n).padStart(5)}  ${reason}`);
  if (R.rate_table.length) {
    line(`   NOTE: the engine keys rates on (carrier, origin_region, destination_region) —`);
    line(`         four Census regions, so ${rates.length} lane rows collapse to ${R.rate_table.length}. Lane detail is lost.`);
  }

  const payload = { shipments: S.shipments, carriers: C.carriers, rate_table: R.rate_table };
  const payloadPath = path.join(outDir, 'payload.json');
  fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2));

  fs.writeFileSync(path.join(outDir, 'preflight.json'), JSON.stringify({
    requested: orders.length, eligible: pre.eligible.length,
    excluded: pre.excluded, counts: pre.counts,
    mapping_skipped: { shipments: S.skipped, carriers: C.skipped, rate_table: R.skipped.slice(0, 200) },
    estimated_volume_ids: S.meta.estimated,
    density_assumption_lb_per_cuft: density || null,
  }, null, 2));

  // ── 4. Readiness gate ──────────────────────────────────────────────
  const blockers = [];
  if (!S.shipments.length) blockers.push('no shipments mapped — the engine would receive an empty batch');
  if (!C.carriers.length) blockers.push('no carriers mapped — nothing to assign freight to');
  if (!R.rate_table.length) blockers.push('rate_table is empty — the engine falls back to its own internal pricing, silently');

  rule();
  if (blockers.length) {
    line('NOT READY:');
    blockers.forEach((b) => line(`  - ${b}`));
    line(`\nArtifacts written to ${outDir}`);
    if (!force) { rule(); process.exit(1); }
    line('--force given; sending anyway.');
  } else {
    line('Payload is well-formed.');
  }
  line(`payload          ${payloadPath}`);

  if (dry) { rule(); line('Dry run — nothing sent.'); process.exit(0); }

  if (!API_KEY) {
    console.error('\nQUANTUM_ENGINE_API_KEY is not set. Add it to api/.env or export it, then re-run.');
    console.error('The payload above is already written, so nothing is lost.');
    process.exit(1);
  }

  // ── 5. Send, exactly as the vendor manual documents ────────────────
  line(`\nPOST ${ENGINE_URL}/api/v1/optimize/${task}`);
  const t0 = Date.now();
  let result;
  try {
    result = task === 'rates'
      ? await engine.optimizeRates(payload)
      : await engine.optimizeConsolidate(payload);
  } catch (err) {
    const elapsedErr = Date.now() - t0;
    console.error(`\nEngine call failed after ${elapsedErr} ms: ${err.message}`);
    fs.writeFileSync(path.join(outDir, 'error.txt'), String(err.stack || err.message));
    if (/fetch failed|ECONNREFUSED|socket/i.test(err.message)) {
      console.error(`The container may not be up.  curl ${ENGINE_URL}/api/v1/health`);
    }
    if (/401|API Key/i.test(err.message)) {
      console.error('That reads like an auth failure — check QUANTUM_ENGINE_API_KEY, and that the key has not expired.');
    }
    process.exit(2);
  }
  const elapsed = Date.now() - t0;
  fs.writeFileSync(path.join(outDir, 'response.json'), JSON.stringify(result, null, 2));
  line(`200 OK in ${elapsed} ms  ·  response.json written`);

  // ── 6. Re-validate: the engine does not enforce the caps we sent ───
  if (task !== 'consolidate') {
    rule('═');
    line(`Done. Artifacts in ${outDir}`);
    process.exit(0);
  }

  const v = mapper.validateConsolidation(result, C.carriers);
  fs.writeFileSync(path.join(outDir, 'validated.json'), JSON.stringify(v, null, 2));

  rule('═');
  line('CAPACITY RE-VALIDATION  (the engine treats weight_cap_lbs as advisory)');
  rule();
  line(`groups returned  ${v.totals.groups_returned}`);
  line(`  feasible       ${v.totals.groups_feasible}`);
  line(`  INFEASIBLE     ${v.totals.groups_infeasible}${v.totals.groups_infeasible ? '   <-- these must not be planned' : ''}`);
  line('');
  line(`engine claims    ${money(v.totals.claimed_savings)}`);
  line(`bankable         ${money(v.totals.feasible_savings)}   (feasible groups only)`);
  const gap = (Number(v.totals.claimed_savings) || 0) - (Number(v.totals.feasible_savings) || 0);
  if (gap > 0.005) line(`overstated by    ${money(gap)}`);

  if (v.infeasible.length) {
    line('\nFirst infeasible groups:');
    for (const g of v.infeasible.slice(0, 10)) {
      line(`  ${String(g.group_id).padEnd(10)} ${String(g.shipments && g.shipments.length).padStart(3)} shp  ${g.violations.join('; ')}`);
    }
    if (v.infeasible.length > 10) line(`  … and ${v.infeasible.length - 10} more (see validated.json)`);
  }

  rule('═');
  line(`Artifacts in ${outDir}`);
  line('  payload.json    what was sent');
  line('  preflight.json  what was excluded and why');
  line('  response.json   what the engine returned, untouched');
  line('  validated.json  feasible vs infeasible groups');
  rule('═');
})().catch((e) => { console.error('\nRun failed:', e.stack || e.message); process.exit(2); });
