// ═══════════════════════════════════════════════════════════════════
// Quantum engine dry run — api/scripts/quantumDryRun.js
// ─────────────────────────────────────────────────────────────────────
// Builds the exact payload that would be POSTed to the optimizer from
// live Zoree data and reports what survives, WITHOUT calling the engine.
// This is the test that matters before the container is even runnable:
// it measures data readiness, which is the real constraint.
//
//   node api/scripts/quantumDryRun.js
//   node api/scripts/quantumDryRun.js --density 10 --limit 500 --out payload.json
//
//   --density N   opt into volume estimation at N lb/cu ft (else orders
//                 with no volume are skipped, which today is all of them)
//   --limit N     cap orders pulled (default 2000)
//   --out FILE    write the payload for inspection / manual curl
//
// Exit code is 0 even when coverage is poor — this reports, it doesn't gate.
// ═══════════════════════════════════════════════════════════════════

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const { dbSelect } = require('../services/supabase');
const zipGeo = require('../services/zipGeo');
const mapper = require('../services/quantumEngineMapper');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function tally(skipped) {
  const counts = new Map();
  for (const s of skipped) {
    // collapse "no geo for dest zip 12345" -> "no geo for dest zip"
    const key = s.reason.replace(/\s+\S*\d\S*$/, '').trim();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function pct(n, d) { return d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a'; }

(async () => {
  const density = Number(arg('density', 0)) || undefined;
  const limit = Number(arg('limit', 2000));
  const outFile = arg('out', null);

  console.log('Loading zip_geo...');
  await zipGeo.load();
  console.log(`  ${zipGeo.size()} zips cached\n`);

  const [orders, carriers, rates, shipments, equipment] = await Promise.all([
    dbSelect('orders', { limit }),
    dbSelect('carriers', {}),
    dbSelect('rates', { limit: 5000 }),
    dbSelect('shipments', { limit: 5000 }),
    dbSelect('equipment_types', {}),
  ]);

  // Real mileage beats the haversine fallback wherever a shipment has it.
  const milesByOrderId = new Map();
  for (const s of shipments) {
    if (!s.miles || !Array.isArray(s.order_ids)) continue;
    for (const oid of s.order_ids) if (!milesByOrderId.has(oid)) milesByOrderId.set(oid, Number(s.miles));
  }

  const capsByCarrierId = new Map();
  const byCode = new Map(equipment.map((e) => [String(e.code).toUpperCase(), e]));
  for (const c of carriers) {
    const eq = byCode.get(String(c.mode).toUpperCase() === 'LTL' ? 'LTL' : 'DV53');
    if (eq) capsByCarrierId.set(c.id, { max_weight: Number(eq.max_weight), max_volume: Number(eq.max_volume) });
  }

  const S = mapper.toEngineShipments(orders, {
    resolveGeo: zipGeo.resolveGeo, milesByOrderId, assumedDensityLbPerCuft: density,
  });
  const C = mapper.toEngineCarriers(carriers, { capsByCarrierId });
  const R = mapper.toEngineRateTable(rates, { regionOf: zipGeo.regionOf });

  const line = (s) => console.log(s);
  line('═'.repeat(64));
  line('QUANTUM ENGINE DRY RUN');
  line('═'.repeat(64));
  line(`density assumption : ${density ? density + ' lb/cu ft' : 'OFF (orders without volume are skipped)'}`);
  line(`real mileage known : ${milesByOrderId.size} orders\n`);

  line(`SHIPMENTS  ${S.shipments.length}/${orders.length} mapped (${pct(S.shipments.length, orders.length)})`);
  for (const [reason, n] of tally(S.skipped)) line(`   skipped ${String(n).padStart(5)}  ${reason}`);
  if (S.meta.estimated.length) line(`   NOTE: ${S.meta.estimated.length} shipments carry an ESTIMATED volume, not a measured one`);

  line(`\nCARRIERS   ${C.carriers.length}/${carriers.length} mapped (${pct(C.carriers.length, carriers.length)})`);
  for (const [reason, n] of tally(C.skipped)) line(`   skipped ${String(n).padStart(5)}  ${reason}`);

  line(`\nRATE TABLE ${R.rate_table.length}/${rates.length} mapped (${pct(R.rate_table.length, rates.length)})`);
  for (const [reason, n] of tally(R.skipped).slice(0, 6)) line(`   skipped ${String(n).padStart(5)}  ${reason}`);

  const blockers = [];
  if (!S.shipments.length) blockers.push('no shipments map — the engine would receive an empty batch');
  if (!C.carriers.length) blockers.push('no carriers map — nothing to assign freight to (check cost_per_mile)');
  if (!R.rate_table.length) blockers.push('rate_table is empty — the engine will fall back to its own internal pricing, silently');

  line('\n' + '─'.repeat(64));
  if (blockers.length) {
    line('NOT READY TO CALL THE ENGINE:');
    blockers.forEach((b) => line(`  - ${b}`));
  } else {
    line('Payload is well-formed. Ready to POST to /api/v1/optimize/consolidate.');
  }
  line('─'.repeat(64));

  if (outFile) {
    fs.writeFileSync(outFile, JSON.stringify(
      { shipments: S.shipments, carriers: C.carriers, rate_table: R.rate_table }, null, 2));
    line(`\nPayload written to ${outFile}`);
  }
})().catch((e) => { console.error('\nDry run failed:', e.message); process.exit(1); });
