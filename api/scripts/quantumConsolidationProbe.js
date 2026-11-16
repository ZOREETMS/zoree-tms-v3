// ═══════════════════════════════════════════════════════════════════
// Consolidation conformance probe — api/scripts/quantumConsolidationProbe.js
// ─────────────────────────────────────────────────────────────────────
//   node api/scripts/quantumConsolidationProbe.js            # print payloads
//   node api/scripts/quantumConsolidationProbe.js --call     # run + grade
//
// Four minimal cases built ONLY from attributes the engine accepts today
// (weight_lbs, volume_cuft, lat/lon, regions, distance, sla_hours). Each
// has one obviously correct answer, so any deviation is a defect rather
// than a judgement call. No database and no Zoree data — this tests the
// engine, not our mapping, and runs anywhere.
//
// Deliberately NOT tested (the payload has no field for them): time
// windows, stop limits and stop-off cost, pallet/floor positions,
// stackability, equipment type, hazmat and compatibility flags, carrier
// lane coverage, weight-break pricing. Passing this probe means the
// consolidator respects capacity — it does not mean it plans real freight.
// ═══════════════════════════════════════════════════════════════════

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const engine = require('../services/quantumEngine');

const CAP_W = 45000;   // DV53, from equipment_types
const CAP_V = 3800;

const CHI = { city: 'Chicago',     lat: 41.8858, lon: -87.6181, region: 'Midwest' };
const DET = { city: 'Detroit',     lat: 42.3314, lon: -83.0458, region: 'Midwest' };
const LAX = { city: 'Los Angeles', lat: 34.0614, lon: -118.2385, region: 'West' };
const PHX = { city: 'Phoenix',     lat: 33.4484, lon: -112.0740, region: 'West' };

const ship = (id, o, d, miles, w, v) => ({
  id, origin_region: o.region, destination_region: d.region,
  distance_miles: miles, weight_lbs: w, volume_cuft: v,
  origin_city: o.city, destination_city: d.city,
  origin_lat: o.lat, origin_lon: o.lon,
  destination_lat: d.lat, destination_lon: d.lon,
  sla_hours: 72,
});

const CARRIER = {
  id: 'PROBE1', name: 'Probe Carrier', base_fee: 150, rate_per_mile: 2.10,
  weight_cap_lbs: CAP_W, volume_cap_cuft: CAP_V, transit_multiplier: 1.0, reliability: 0.97,
};
const RATE_TABLE = [
  { carrier_id: 'PROBE1', origin_region: 'Midwest', destination_region: 'Midwest', rate_per_lb: 0.05, rate_per_cuft: 0.25, minimum_charge: 120 },
  { carrier_id: 'PROBE1', origin_region: 'West',    destination_region: 'West',    rate_per_lb: 0.05, rate_per_cuft: 0.25, minimum_charge: 120 },
];

const CASES = [
  {
    key: 'A-control',
    what: 'Two small shipments, identical lane. Should consolidate into one group.',
    expect: 'exactly 1 group containing both ids',
    shipments: [ship('A1', CHI, DET, 280, 5000, 400), ship('A2', CHI, DET, 280, 5000, 400)],
    grade(groups) {
      if (groups.length !== 1) return `expected 1 group, got ${groups.length} — engine is not consolidating obviously compatible freight`;
      const ids = (groups[0].shipments || []).slice().sort();
      return ids.length === 2 ? null : `group holds ${ids.length} shipments, expected 2`;
    },
  },
  {
    key: 'B-weight-cap',
    what: `Four x 12,000 lb on one lane = 48,000 lb, over the ${CAP_W} lb cap.`,
    expect: `at least 2 groups; no group over ${CAP_W} lb`,
    shipments: [1, 2, 3, 4].map((n) => ship(`B${n}`, CHI, DET, 280, 12000, 900)),
    grade(groups) {
      const over = groups.filter((g) => Number(g.combined_weight_lbs) > CAP_W);
      if (over.length) return `${over.length} group(s) exceed the weight cap — CAPACITY NOT ENFORCED (max ${Math.max(...over.map((g) => g.combined_weight_lbs))} lb)`;
      return groups.length >= 2 ? null : `expected the load to split into >=2 groups, got ${groups.length}`;
    },
  },
  {
    key: 'C-volume-cap',
    what: `Four x 1,000 cu ft on one lane = 4,000 cu ft, over the ${CAP_V} cu ft cap (weight is fine).`,
    expect: `at least 2 groups; no group over ${CAP_V} cu ft`,
    shipments: [1, 2, 3, 4].map((n) => ship(`C${n}`, CHI, DET, 280, 8000, 1000)),
    grade(groups) {
      const over = groups.filter((g) => Number(g.combined_volume_cuft) > CAP_V);
      if (over.length) return `${over.length} group(s) exceed the cube cap — CUBE NOT ENFORCED (max ${Math.max(...over.map((g) => g.combined_volume_cuft))} cu ft)`;
      return groups.length >= 2 ? null : `expected >=2 groups, got ${groups.length}`;
    },
  },
  {
    key: 'D-geography',
    what: 'Chicago->Detroit and Los Angeles->Phoenix. Nothing may merge these.',
    expect: 'D1 and D2 never in the same group',
    shipments: [ship('D1', CHI, DET, 280, 5000, 400), ship('D2', LAX, PHX, 373, 5000, 400)],
    grade(groups) {
      const bad = groups.find((g) => (g.shipments || []).includes('D1') && (g.shipments || []).includes('D2'));
      return bad ? `group ${bad.group_id} merged shipments 1,700 miles apart — spatial clustering is broken` : null;
    },
  },
];

const payloadFor = (c) => ({ shipments: c.shipments, carriers: [CARRIER], rate_table: RATE_TABLE });
const groupsOf = (r) => (r && r.consolidate && r.consolidate.groups) || (r && r.groups) || [];

(async () => {
  const call = process.argv.includes('--call');

  if (!call) {
    console.log('Payloads only — re-run with --call to execute against the engine.\n');
    for (const c of CASES) {
      console.log('─'.repeat(64));
      console.log(`${c.key}: ${c.what}`);
      console.log(`expect: ${c.expect}`);
      console.log(JSON.stringify(payloadFor(c), null, 2));
    }
    return;
  }

  console.log('Checking engine health...');
  await engine.checkHealth();
  console.log('ok\n');

  let failures = 0;
  for (const c of CASES) {
    process.stdout.write(`${c.key.padEnd(16)} `);
    let groups;
    try {
      groups = groupsOf(await engine.optimizeConsolidate(payloadFor(c)));
    } catch (e) {
      console.log(`ERROR — ${e.message}`); failures++; continue;
    }
    const problem = c.grade(groups);
    if (problem) { console.log(`FAIL — ${problem}`); failures++; }
    else console.log(`pass  (${groups.length} group${groups.length === 1 ? '' : 's'})`);
    for (const g of groups) {
      console.log(`                 ${String(g.group_id).padEnd(10)} ${(g.shipments || []).join(',').padEnd(20)} ${g.combined_weight_lbs} lb / ${g.combined_volume_cuft} cu ft`);
    }
  }

  console.log('\n' + '─'.repeat(64));
  console.log(failures ? `${failures} of ${CASES.length} cases FAILED` : `all ${CASES.length} cases passed`);
  console.log('Passing means capacity and geography are respected. It does not');
  console.log('mean the engine can plan real freight — see the header for what');
  console.log('this payload cannot express.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('Probe failed:', e.message); process.exit(1); });
