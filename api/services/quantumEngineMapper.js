// ═══════════════════════════════════════════════════════════════════
// Quantum Engine Mapper — api/services/quantumEngineMapper.js
// ─────────────────────────────────────────────────────────────────────
// Maps Zoree orders / carriers / rates into the request body the Otodus
// Quantum engine expects, and maps its consolidate response back into
// proposal rows. This is the mapper that services/quantumEngine.js
// (the HTTP client) deliberately left out — that file stays a dumb
// transport; all shape knowledge lives here.
//
// Engine payload contract, read out of the vendor container itself
// (`scripts/sample_input.json` inside tms-platform:latest), NOT from the
// manual — the manual never publishes it:
//
//   shipments[]  id, origin_region, destination_region, distance_miles,
//                weight_lbs, volume_cuft, origin_city, destination_city,
//                origin_lat, origin_lon, destination_lat, destination_lon,
//                sla_hours
//   carriers[]   id, name, base_fee, rate_per_mile, weight_cap_lbs,
//                volume_cap_cuft, transit_multiplier, reliability
//   rate_table[] carrier_id, origin_region, destination_region,
//                rate_per_lb, rate_per_cuft, minimum_charge
//
// ── Design rule: never fabricate a field the engine prices on ──
// The engine has no "unknown" representation. A missing weight or volume
// arrives as 0 and is silently treated as free capacity — that is exactly
// how the vendor's own 300k benchmark produced groups of 269,887 lbs and
// 19,363 cu ft (half its groups exceed a 53' trailer). So every field the
// optimizer prices on is REQUIRED here: a record that cannot supply one
// is dropped into `skipped` with a reason instead of being zero-filled.
// Read `skipped` on every call — a shrinking batch is a data problem, not
// a smaller optimization.
//
// Volume is the one exception, and it is opt-in. Zoree has no volume
// anywhere: order_lines carry weight but no dimensions, and nothing links
// them to packaging_units. Passing `assumedDensityLbPerCuft` turns on a
// density estimate and every affected id is reported in `meta.estimated`
// so a caller can refuse to act on those groups.
//
// Geo is injected, not queried. `resolveGeo(zip)` is supplied by the
// caller so this module stays pure and unit-testable, and so it is not
// blocked on where zip→lat/lng/state eventually lives. Today only 1 of
// 1,113 orders carries both location ids, so a locations join is not a
// viable path — zips are (984 of 1,113).
// ═══════════════════════════════════════════════════════════════════

'use strict';

const { regionForState } = require('../constants/usRegions');

const EARTH_RADIUS_MI = 3958.8;
// Great-circle → road distance. Standard highway circuity for US truckload;
// only used when a real mileage (shipments.miles / PC*Miler) is absent.
const CIRCUITY_FACTOR = 1.2;

function haversineMiles(aLat, aLon, bLat, bLon) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Whole hours between ready and due; null when either is missing/invalid. */
function slaHours(readyDate, dueDate) {
  if (!readyDate || !dueDate) return null;
  const a = Date.parse(readyDate);
  const b = Date.parse(dueDate);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.max(1, Math.round((b - a) / 3600000));
}

/**
 * Map Zoree orders into engine `shipments[]`.
 *
 * @param {object[]} orders          rows from `orders`
 * @param {object}   opts
 * @param {(zip:string)=>({lat:number,lng:number,state:string,city:string}|null)} opts.resolveGeo
 * @param {Map<string,number>}  [opts.milesByOrderId]  real mileage where known
 * @param {number}   [opts.assumedDensityLbPerCuft]    opt-in volume estimate
 * @returns {{shipments:object[], skipped:object[], meta:{estimated:string[]}}}
 */
function toEngineShipments(orders, opts = {}) {
  const { resolveGeo, milesByOrderId, assumedDensityLbPerCuft } = opts;
  if (typeof resolveGeo !== 'function') {
    throw Object.assign(new Error('toEngineShipments requires opts.resolveGeo(zip)'), { status: 500 });
  }

  const shipments = [];
  const skipped = [];
  const estimated = [];
  const skip = (order, reason) => skipped.push({ id: order && order.id, reason });

  for (const order of orders || []) {
    if (!order || !order.id) { skip(order, 'missing id'); continue; }

    const oZip = order.origin_zip && String(order.origin_zip).trim();
    const dZip = order.dest_zip && String(order.dest_zip).trim();
    if (!oZip || !dZip) { skip(order, 'missing origin_zip or dest_zip'); continue; }

    const o = resolveGeo(oZip);
    const d = resolveGeo(dZip);
    if (!o) { skip(order, `no geo for origin zip ${oZip}`); continue; }
    if (!d) { skip(order, `no geo for dest zip ${dZip}`); continue; }

    const originRegion = regionForState(o.state);
    const destRegion = regionForState(d.state);
    if (!originRegion) { skip(order, `unmapped origin state ${o.state}`); continue; }
    if (!destRegion) { skip(order, `unmapped dest state ${d.state}`); continue; }

    const weight = num(order.weight);
    if (weight === null || weight <= 0) { skip(order, 'missing or non-positive weight'); continue; }

    let distance = milesByOrderId && num(milesByOrderId.get(order.id));
    if (distance === null || distance === undefined || distance <= 0) {
      distance = haversineMiles(o.lat, o.lng, d.lat, d.lng) * CIRCUITY_FACTOR;
    }
    if (!(distance > 0)) { skip(order, 'could not derive distance_miles'); continue; }

    // Volume: only ever present by explicit opt-in. See header.
    let volumeEstimated = false;
    let volume = num(order.volume_cuft);
    if (volume === null || volume <= 0) {
      if (!(assumedDensityLbPerCuft > 0)) { skip(order, 'no volume_cuft and no assumedDensityLbPerCuft'); continue; }
      volume = weight / assumedDensityLbPerCuft;
      volumeEstimated = true;
    }

    const sla = slaHours(order.ready, order.due);
    if (sla === null) { skip(order, 'cannot derive sla_hours from ready/due'); continue; }

    // Recorded only now, so a record skipped by a later check never
    // shows up as an estimated shipment that was not actually sent.
    if (volumeEstimated) estimated.push(order.id);

    shipments.push({
      id: String(order.id),
      origin_region: originRegion,
      destination_region: destRegion,
      distance_miles: Number(distance.toFixed(1)),
      weight_lbs: weight,
      volume_cuft: Number(volume.toFixed(1)),
      origin_city: order.origin || o.city || '',
      destination_city: order.dest || d.city || '',
      origin_lat: o.lat,
      origin_lon: o.lng,
      destination_lat: d.lat,
      destination_lon: d.lng,
      sla_hours: sla,
    });
  }

  return { shipments, skipped, meta: { estimated } };
}

/**
 * Map Zoree carriers into engine `carriers[]`.
 *
 * Capacity caps are the whole point of this array — they are what should
 * stop the consolidator building 269k-lb groups. `carriers.max_weight` is
 * null for all 11 rows today, so caps come from the carrier's equipment
 * type; a carrier with neither is dropped rather than sent uncapped.
 *
 * @param {object[]} carriers
 * @param {object}   opts
 * @param {Map<string,{max_weight:number,max_volume:number}>} opts.capsByCarrierId
 * @param {number}   [opts.defaultBaseFee=0]
 */
function toEngineCarriers(carriers, opts = {}) {
  const { capsByCarrierId, defaultBaseFee = 0 } = opts;
  const out = [];
  const skipped = [];

  for (const c of carriers || []) {
    if (!c || !c.id) { skipped.push({ id: c && c.id, reason: 'missing id' }); continue; }

    const ratePerMile = num(c.cost_per_mile);
    if (ratePerMile === null || ratePerMile <= 0) {
      skipped.push({ id: c.id, reason: 'missing cost_per_mile' });
      continue;
    }

    const caps = (capsByCarrierId && capsByCarrierId.get(c.id)) || {};
    const weightCap = num(c.max_weight) ?? num(caps.max_weight);
    const volumeCap = num(caps.max_volume);
    if (!(weightCap > 0)) { skipped.push({ id: c.id, reason: 'no weight capacity (carriers.max_weight and equipment max_weight both null)' }); continue; }
    if (!(volumeCap > 0)) { skipped.push({ id: c.id, reason: 'no volume capacity (equipment max_volume null)' }); continue; }

    // reliability is a 0–1 probability in the engine; on_time_pct is 0–100.
    const onTime = num(c.on_time_pct);
    const reliability = onTime === null ? 0.95 : Math.max(0, Math.min(1, onTime / 100));

    out.push({
      id: String(c.id),
      name: c.name || String(c.id),
      base_fee: num(c.base_fee) ?? defaultBaseFee,
      rate_per_mile: ratePerMile,
      weight_cap_lbs: weightCap,
      volume_cap_cuft: volumeCap,
      transit_multiplier: num(c.transit_multiplier) ?? 1.0,
      reliability,
    });
  }

  return { carriers: out, skipped };
}

/**
 * Map Zoree `rates` rows into engine `rate_table[]`.
 *
 * `rates.rate` is TEXT with a companion `unit`, so only rows whose unit is
 * per-pound convert cleanly. Per-mile and flat rows carry no per-lb price
 * and are skipped — the engine already gets per-mile economics from
 * carriers[].rate_per_mile, so dropping them loses nothing.
 *
 * @param {object[]} rates
 * @param {object}   opts
 * @param {(row:object)=>string|null} opts.regionOf  origin/dest region resolver
 */
function toEngineRateTable(rates, opts = {}) {
  const { regionOf } = opts;
  if (typeof regionOf !== 'function') {
    throw Object.assign(new Error('toEngineRateTable requires opts.regionOf(row)'), { status: 500 });
  }

  const out = [];
  const skipped = [];
  const seen = new Set();

  for (const r of rates || []) {
    if (!r || !r.carrier) { skipped.push({ id: r && r.id, reason: 'missing carrier' }); continue; }
    if (r.status && String(r.status).toLowerCase() !== 'active') {
      skipped.push({ id: r.id, reason: `status ${r.status}` });
      continue;
    }

    const unit = (r.unit || '').toLowerCase();
    const rate = num(r.rate);
    if (rate === null || rate <= 0) { skipped.push({ id: r.id, reason: 'unparseable rate' }); continue; }
    if (!/lb|pound|cwt/.test(unit)) { skipped.push({ id: r.id, reason: `unit '${r.unit}' is not per-weight` }); continue; }

    // CWT is per hundredweight.
    const ratePerLb = /cwt/.test(unit) ? rate / 100 : rate;

    const oRegion = regionOf({ zip: r.origin_zip, text: r.origin });
    const dRegion = regionOf({ zip: r.dest_zip, text: r.dest });
    if (!oRegion || !dRegion) { skipped.push({ id: r.id, reason: 'could not resolve lane regions' }); continue; }

    // Engine keys on (carrier, origin_region, destination_region); collapse
    // duplicate lane rows to the cheapest so the key stays unique.
    const key = `${r.carrier}|${oRegion}|${dRegion}`;
    const existing = seen.has(key) ? out.find((x) => `${x.carrier_id}|${x.origin_region}|${x.destination_region}` === key) : null;
    if (existing) {
      if (ratePerLb < existing.rate_per_lb) existing.rate_per_lb = ratePerLb;
      continue;
    }
    seen.add(key);

    out.push({
      carrier_id: String(r.carrier),
      origin_region: oRegion,
      destination_region: dRegion,
      rate_per_lb: ratePerLb,
      rate_per_cuft: num(r.rate_per_cuft) ?? 0,
      minimum_charge: num(r.minimum_charge) ?? 0,
    });
  }

  return { rate_table: out, skipped };
}

/**
 * Validate the engine's consolidate response against the capacities we sent.
 *
 * The engine does NOT enforce carriers[].weight_cap_lbs / volume_cap_cuft —
 * verified against the vendor's own bundled_300k.json, where 6,615 of 13,041
 * groups exceed 45,000 lbs of payload and 1,491 exceed 80,000 lbs gross.
 * So every group is re-checked here before anything is persisted or shown
 * to a planner. Infeasible groups are returned separately, never silently
 * dropped and never counted toward savings.
 *
 * @returns {{feasible:object[], infeasible:object[], totals:object}}
 */
function validateConsolidation(result, engineCarriers) {
  const capsById = new Map((engineCarriers || []).map((c) => [String(c.id), c]));
  const groups = (result && result.consolidate && result.consolidate.groups) || (result && result.groups) || [];

  const feasible = [];
  const infeasible = [];

  for (const g of groups) {
    const cap = capsById.get(String(g.carrier_id));
    const weight = num(g.combined_weight_lbs) ?? 0;
    const volume = num(g.combined_volume_cuft) ?? 0;
    const violations = [];

    if (!cap) violations.push(`unknown carrier_id ${g.carrier_id}`);
    if (cap && weight > cap.weight_cap_lbs) violations.push(`weight ${weight} > cap ${cap.weight_cap_lbs}`);
    if (cap && volume > cap.volume_cap_cuft) violations.push(`volume ${volume} > cap ${cap.volume_cap_cuft}`);
    if (weight <= 0) violations.push('zero combined weight');

    (violations.length ? infeasible : feasible).push(
      violations.length ? { ...g, violations } : g
    );
  }

  const sum = (rows, k) => rows.reduce((t, r) => t + (num(r[k]) || 0), 0);
  return {
    feasible,
    infeasible,
    totals: {
      groups_returned: groups.length,
      groups_feasible: feasible.length,
      groups_infeasible: infeasible.length,
      // Savings counted from feasible groups ONLY. The engine's headline
      // number includes infeasible ones and is not bankable.
      claimed_savings: sum(groups, 'savings'),
      feasible_savings: sum(feasible, 'savings'),
    },
  };
}

/**
 * Pick the per-mile cost the engine should use for one carrier on one lane.
 *
 * Why this exists: carriers.cost_per_mile is 0.0000 for 10 of 11 carriers,
 * but the real per-mile economics DO exist — they live in `rates` as
 * lane-specific "per mile" rows (e.g. College Park GA -> Dallas TX carries
 * $2.10-$2.89 across carriers, varying by transit_days). Reading
 * carriers.cost_per_mile alone therefore throws away the only real pricing
 * in the system. For single-lane planning, lane rates must win.
 *
 * A carrier commonly has several rows for the same lane at different
 * service levels (1-day vs 4-day at different prices). We take the
 * cheapest that still meets the SLA, since the engine has no service-level
 * concept to arbitrate with; `maxTransitDays` lets a caller enforce it.
 *
 * @param {Array<{rate:object}>|Array<object>} matched  rows from rateMatcher.matchAllRates
 * @param {{maxTransitDays?:number}} [opts]
 * @returns {{rate_per_mile:number, source_rate_id:*, transit_days:*}|null}
 */
function pickLaneRatePerMile(matched, opts = {}) {
  const { maxTransitDays } = opts;
  let best = null;
  for (const entry of matched || []) {
    const r = entry && entry.rate ? entry.rate : entry;
    if (!r) continue;
    if (!/mile/i.test(r.unit || '')) continue;          // only per-mile rows
    const v = num(r.rate);
    if (v === null || v <= 0) continue;                  // "$0.00" and "" rows
    const td = num(r.transit_days);
    if (maxTransitDays && td !== null && td > maxTransitDays) continue;
    if (!best || v < best.rate_per_mile) {
      best = { rate_per_mile: v, source_rate_id: r.id, transit_days: td };
    }
  }
  return best;
}

module.exports = {
  toEngineShipments,
  toEngineCarriers,
  pickLaneRatePerMile,
  toEngineRateTable,
  validateConsolidation,
  _internals: { haversineMiles, slaHours, CIRCUITY_FACTOR },
};
