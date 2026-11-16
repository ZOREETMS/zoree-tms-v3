// ═══════════════════════════════════════════════════════════════════
// Plan ONE order through the quantum engine — api/scripts/quantumPlanOrder.js
// ─────────────────────────────────────────────────────────────────────
//   node api/scripts/quantumPlanOrder.js ORD-392931 --density 12
//   node api/scripts/quantumPlanOrder.js ORD-392931 --density 12 --call
//
//   --density N   lb/cu ft used to derive volume (orders carry no volume)
//   --call        actually POST to the engine; without it, payload only
//   --task X      rates (default) | consolidate
//   --out FILE    write the payload to a file
//
// Task choice matters: `consolidate` bundles MULTIPLE shipments into a
// truckload. Planning a single order is a carrier-assignment problem, so
// this defaults to `rates`. Consolidating one order can only ever return
// that same order in a group of one.
//
// Carrier per-mile cost comes from the LANE rate rows, not from
// carriers.cost_per_mile — see pickLaneRatePerMile in the mapper for why.
// Nothing is written back to the database; this prints a proposal.
// ═══════════════════════════════════════════════════════════════════

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const { dbSelect } = require('../services/supabase');
const zipGeo = require('../services/zipGeo');
const mapper = require('../services/quantumEngineMapper');
const rateMatcher = require('../services/rateMatcher');
const engine = require('../services/quantumEngine');

const argv = process.argv.slice(2);
const orderId = argv.find((a) => !a.startsWith('--'));
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const has = (n) => argv.includes(`--${n}`);

const money = (n) => (n === null || n === undefined ? 'n/a' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

(async () => {
  if (!orderId) { console.error('Usage: node api/scripts/quantumPlanOrder.js <ORDER_ID> [--density N] [--call]'); process.exit(1); }

  const density = Number(flag('density', 0)) || undefined;
  const task = flag('task', 'rates');

  await zipGeo.load();

  const [order] = await dbSelect('orders', { filters: [['id', 'eq', orderId]], limit: 1 });
  if (!order) { console.error(`Order ${orderId} not found.`); process.exit(1); }

  console.log('═'.repeat(64));
  console.log(`PLAN ${order.id}  —  ${order.customer || 'no customer'}`);
  console.log('═'.repeat(64));
  console.log(`${order.origin}  ->  ${order.dest}`);
  console.log(`${Number(order.weight).toLocaleString()} lb · ${order.pieces} pcs · ${order.ship_mode || '?'} · ready ${order.ready} due ${order.due} · status "${order.status}"\n`);

  // ── shipment ─────────────────────────────────────────────────────
  const shipments = await dbSelect('shipments', { limit: 5000 });
  const milesByOrderId = new Map();
  for (const s of shipments) {
    if (!s.miles || !Array.isArray(s.order_ids)) continue;
    for (const oid of s.order_ids) if (!milesByOrderId.has(oid)) milesByOrderId.set(oid, Number(s.miles));
  }

  const S = mapper.toEngineShipments([order], { resolveGeo: zipGeo.resolveGeo, milesByOrderId, assumedDensityLbPerCuft: density });
  if (!S.shipments.length) {
    console.error(`Cannot map this order: ${S.skipped[0].reason}`);
    if (/volume/.test(S.skipped[0].reason)) console.error('Pass --density N (lb/cu ft) to derive volume.');
    process.exit(1);
  }
  const ship = S.shipments[0];
  const estimated = S.meta.estimated.includes(order.id);
  console.log(`shipment  ${ship.origin_region} -> ${ship.destination_region} · ${ship.distance_miles} mi · ${ship.weight_lbs} lb · ${ship.volume_cuft} cu ft${estimated ? '  [VOLUME ESTIMATED]' : ''} · SLA ${ship.sla_hours} h`);

  // ── carriers, priced from the lane ───────────────────────────────
  const [carriersAll, rates, equipment] = await Promise.all([
    dbSelect('carriers', {}), dbSelect('rates', { limit: 5000 }), dbSelect('equipment_types', {}),
  ]);
  const byCode = new Map(equipment.map((e) => [String(e.code).toUpperCase(), e]));

  // ship_mode is a planning CONSTRAINT (see REQ-10 in orderMutations.js):
  // when the order carries one, the shipper has dictated the mode and we
  // honour it. When it is null the TMS chooses, and the choice is made
  // against this database's own LTL equipment ceiling rather than a
  // hardcoded number — above the LTL max weight the load can only move
  // as truckload. Never default a null mode to TL: that would force a
  // 6,000 lb order onto a truckload rate and silently mis-plan it.
  const ltlCap = Number((byCode.get('LTL') || {}).max_weight) || 20000;
  const declaredMode = order.ship_mode ? String(order.ship_mode).toUpperCase() : null;
  const mode = declaredMode || (Number(order.weight) > ltlCap ? 'TL' : 'LTL');
  console.log(`mode      ${mode}${declaredMode ? ' (declared on the order)' : ` (selected by TMS: ${Number(order.weight).toLocaleString()} lb vs LTL ceiling ${ltlCap.toLocaleString()} lb)`}`);
  const ctx = {
    originCity: order.origin, destCity: order.dest,
    originZip: order.origin_zip, destZip: order.dest_zip,
  };
  const maxTransitDays = Math.floor(ship.sla_hours / 24) || undefined;

  const engineCarriers = [];
  const carrierNotes = [];
  for (const c of carriersAll) {
    if (String(c.mode).toUpperCase() !== mode) continue;
    const eq = byCode.get(mode === 'LTL' ? 'LTL' : 'DV53');
    const caps = new Map([[c.id, { max_weight: Number(eq.max_weight), max_volume: Number(eq.max_volume) }]]);

    const candidates = rates.filter((r) => String(r.carrier || '').toUpperCase() === String(c.name || '').toUpperCase()
      && String(r.mode || '').toUpperCase() === mode
      && String(r.status || '').toLowerCase() === 'active');
    const { rates: matched } = rateMatcher.matchAllRates(ctx, candidates);
    const lane = mapper.pickLaneRatePerMile(matched, { maxTransitDays });

    const shaped = mapper.toEngineCarriers(
      [{ ...c, cost_per_mile: lane ? lane.rate_per_mile : c.cost_per_mile }],
      { capsByCarrierId: caps }
    );
    if (shaped.carriers.length) {
      engineCarriers.push(shaped.carriers[0]);
      carrierNotes.push(`  ${c.name.padEnd(24)} $${lane ? lane.rate_per_mile.toFixed(2) : Number(c.cost_per_mile).toFixed(2)}/mi ${lane ? `(rate #${lane.source_rate_id}, ${lane.transit_days}d)` : '(carrier default)'}  est ${money((lane ? lane.rate_per_mile : c.cost_per_mile) * ship.distance_miles)}`);
    } else {
      carrierNotes.push(`  ${c.name.padEnd(24)} SKIPPED — ${shaped.skipped[0].reason}`);
    }
  }
  console.log(`\ncarriers (${mode}):`);
  carrierNotes.forEach((n) => console.log(n));

  if (!engineCarriers.length) { console.error('\nNo usable carriers — cannot plan.'); process.exit(1); }

  // capacity feasibility of the order itself, before the engine sees it
  const fits = engineCarriers.filter((c) => ship.weight_lbs <= c.weight_cap_lbs && ship.volume_cuft <= c.volume_cap_cuft);
  if (!fits.length) {
    console.error(`\nThis order does not fit ANY ${mode} carrier: needs ${ship.weight_lbs} lb / ${ship.volume_cuft} cu ft`);
    console.error(`  caps are ${engineCarriers[0].weight_cap_lbs} lb / ${engineCarriers[0].volume_cap_cuft} cu ft`);
    if (estimated) console.error(`  volume is ESTIMATED at ${density} lb/cu ft — a denser assumption may make it fit`);
    process.exit(1);
  }

  const payload = { shipments: [ship], carriers: engineCarriers, rate_table: [] };
  const outFile = flag('out', null);
  if (outFile) { fs.writeFileSync(outFile, JSON.stringify(payload, null, 2)); console.log(`\npayload -> ${outFile}`); }

  if (!has('call')) {
    console.log('\nPayload built. Re-run with --call to send it to the engine.');
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`\nPOSTing to engine (task=${task})...`);
  const result = task === 'consolidate' ? await engine.optimizeConsolidate(payload) : await engine.optimizeRates(payload);

  if (task === 'consolidate') {
    const v = mapper.validateConsolidation(result, engineCarriers);
    console.log(`\ngroups ${v.totals.groups_feasible} feasible / ${v.totals.groups_infeasible} infeasible`);
    console.log(`claimed savings ${money(v.totals.claimed_savings)}  |  FEASIBLE savings ${money(v.totals.feasible_savings)}`);
    v.infeasible.forEach((g) => console.log(`  REJECT ${g.group_id}: ${g.violations.join('; ')}`));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
  console.log('\nNothing was written to the database — this is a proposal.');
})().catch((e) => { console.error('\nFailed:', e.message); process.exit(1); });
