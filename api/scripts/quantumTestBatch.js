// ═══════════════════════════════════════════════════════════════════
// Graded consolidation run — api/scripts/quantumTestBatch.js
// ─────────────────────────────────────────────────────────────────────
//   node api/scripts/quantumTestBatch.js               # build + show payload
//   node api/scripts/quantumTestBatch.js --call        # run and grade
//   node api/scripts/quantumTestBatch.js --density 12  # default 12
//
// Runs the 20 TEST-QE-* orders through the engine and grades the result
// against the one correct answer the fixture was built to have:
//
//   Lane A  7 x 6,000 lb Chicago -> Dallas    = 42,000 lb / 3,500 cu ft
//   Lane B  7 x 6,000 lb Atlanta -> New York  = 42,000 lb / 3,500 cu ft
//   Singles 6 orders on 6 fully distinct lanes, nothing to pair with
//
// Both lanes sit just inside the DV53 cap (45,000 lb / 3,800 cu ft) and
// an eighth order would breach it, so "exactly 7" is arithmetic rather
// than preference. Expected output: 2 groups of 7, 6 orders left alone.
//
// Reads only; nothing is written back to the database.
// ═══════════════════════════════════════════════════════════════════

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { dbSelect } = require('../services/supabase');
const zipGeo = require('../services/zipGeo');
const mapper = require('../services/quantumEngineMapper');
const engine = require('../services/quantumEngine');

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const PREFIX = 'TEST-QE-';
const groupsOf = (r) => (r && r.consolidate && r.consolidate.groups) || (r && r.groups) || [];

(async () => {
  const density = Number(flag('density', 12));
  await zipGeo.load();

  const all = await dbSelect('orders', { limit: 5000 });
  const orders = all.filter((o) => String(o.id).startsWith(PREFIX)).sort((a, b) => a.id.localeCompare(b.id));
  if (orders.length !== 20) console.warn(`WARNING: expected 20 ${PREFIX}* orders, found ${orders.length}`);

  const S = mapper.toEngineShipments(orders, { resolveGeo: zipGeo.resolveGeo, assumedDensityLbPerCuft: density });
  console.log(`mapped ${S.shipments.length}/${orders.length} at ${density} lb/cu ft`);
  S.skipped.forEach((s) => console.log(`  SKIP ${s.id} — ${s.reason}`));
  if (!S.shipments.length) process.exit(1);

  const [carriersAll, equipment] = await Promise.all([dbSelect('carriers', {}), dbSelect('equipment_types', {})]);
  const dv53 = equipment.find((e) => String(e.code).toUpperCase() === 'DV53');
  const caps = new Map(carriersAll.map((c) => [c.id, { max_weight: Number(dv53.max_weight), max_volume: Number(dv53.max_volume) }]));
  // Give every carrier a nominal per-mile cost so carrier data quality
  // (cost_per_mile is 0 on 10 of 11 rows) doesn't confound the grouping test.
  const C = mapper.toEngineCarriers(
    carriersAll.map((c) => ({ ...c, cost_per_mile: Number(c.cost_per_mile) > 0 ? c.cost_per_mile : 2.10 })),
    { capsByCarrierId: caps }
  );
  console.log(`carriers: ${C.carriers.length}/${carriersAll.length}\n`);

  const payload = { shipments: S.shipments, carriers: C.carriers, rate_table: [] };
  if (!argv.includes('--call')) {
    console.log('Payload built. Re-run with --call to send it to the engine.');
    console.log(`  ${payload.shipments.length} shipments, ${payload.carriers.length} carriers`);
    return;
  }

  await engine.checkHealth();
  const groups = groupsOf(await engine.optimizeConsolidate(payload));
  const v = mapper.validateConsolidation({ groups }, C.carriers);

  console.log('─'.repeat(64));
  groups.forEach((g) => {
    const ids = (g.shipments || []).map((s) => String(s).replace(PREFIX, ''));
    console.log(`${String(g.group_id).padEnd(10)} ${String(ids.length).padStart(2)} orders  ${String(g.combined_weight_lbs).padStart(6)} lb / ${String(g.combined_volume_cuft).padStart(6)} cu ft  ${ids.join(',')}`);
  });
  console.log('─'.repeat(64));

  const fails = [];
  const idsOf = (g) => g.shipments || [];
  const laneGroup = (p) => groups.find((g) => idsOf(g).length === 7 && idsOf(g).every((id) => String(id).startsWith(PREFIX + p)));

  for (const [lane, p] of [['A', 'A'], ['B', 'B']]) {
    if (!laneGroup(p)) fails.push(`lane ${lane}: expected one group of exactly 7 ${PREFIX}${p}* orders — not found`);
  }
  const mixed = groups.filter((g) => new Set(idsOf(g).map((id) => String(id).charAt(PREFIX.length))).size > 1);
  mixed.forEach((g) => fails.push(`group ${g.group_id} mixes lanes: ${idsOf(g).join(',')}`));
  groups.filter((g) => idsOf(g).some((id) => String(id).startsWith(PREFIX + 'S')) && idsOf(g).length > 1)
    .forEach((g) => fails.push(`group ${g.group_id} consolidated a distinct-lane single: ${idsOf(g).join(',')}`));
  v.infeasible.forEach((g) => fails.push(`group ${g.group_id} over capacity: ${g.violations.join('; ')}`));

  console.log(`claimed savings $${(v.totals.claimed_savings || 0).toFixed(2)}   feasible savings $${(v.totals.feasible_savings || 0).toFixed(2)}`);
  console.log('');
  if (fails.length) { console.log(`${fails.length} PROBLEM(S):`); fails.forEach((f) => console.log(`  - ${f}`)); }
  else console.log('PASS — 2 groups of 7 on their own lanes, 6 singles untouched, all within capacity.');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
