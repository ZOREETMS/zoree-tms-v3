// ═══════════════════════════════════════════════════════════════════
// Load Cost Model — api/services/quantumLocal/costModel.js
// ─────────────────────────────────────────────────────────────────────
// The exact, classical side of the hybrid optimizer. The QUBO only ever
// sees pairwise approximations; every load the optimizer proposes is
// re-priced and re-checked HERE, shipment by shipment, before it leaves
// the engine. Nothing reports savings that this file has not verified.
//
// Inputs are the same engine-shaped arrays quantumEngineMapper produces
// (shipments[], carriers[], rate_table[]), so the local engine and the
// Otodus container are fed identically.
//
// Model
//   Standalone price of one shipment = cheapest of
//     • truckload:  carrier.base_fee + carrier.rate_per_mile × miles
//     • LTL/rated:  max(minimum_charge, rate_per_lb·w + rate_per_cuft·v)
//                   from rate_table on the shipment's region lane
//   Consolidated load = one multi-stop truckload:
//     cost = base_fee + rate_per_mile × route_miles (cheapest carrier that
//     fits weight, volume and service time)
//   savings = Σ standalone prices − consolidated cost
//
// Feasibility (all hard):
//   weight ≤ carrier.weight_cap_lbs, volume ≤ carrier.volume_cap_cuft,
//   distinct pickups ≤ maxPickups, distinct drops ≤ maxDrops,
//   shipments ≤ maxShipmentsPerLoad,
//   route_miles ≤ maxDetourRatio × longest member's own miles,
//   every member delivered by its due time (or within sla_hours when no
//   ready/due window is known), using a solo-driver HOS clock:
//   11 h driving then a 10 h break, plus dwell per stop.
//
// Mileage: legs between stops are great-circle × 1.2 circuity, scaled by
// the members' own (real miles ÷ estimated miles) ratio, so a one-shipment
// load prices at exactly its real mileage and multi-stop routes inherit
// the same calibration.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const EARTH_RADIUS_MI = 3958.8;
const CIRCUITY = 1.2;

const DEFAULTS = Object.freeze({
  maxPickups: 3,
  maxDrops: 3,
  maxShipmentsPerLoad: 10,
  maxDetourRatio: 1.6,
  avgMph: 50,
  hosDriveHours: 11,
  hosBreakHours: 10,
  dwellHoursPerStop: 1,
  ltlMaxWeightLbs: 20000, // used only when a rate_table carrier has no caps of its own
});

function haversine(aLat, aLon, bLat, bLon) {
  const r = (d) => (d * Math.PI) / 180;
  const dLat = r(bLat - aLat);
  const dLon = r(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}
const estMiles = (a, b) => haversine(a.lat, a.lon, b.lat, b.lon) * CIRCUITY;
const pointKey = (lat, lon) => `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;

/** Elapsed clock hours for a given number of driving hours (solo HOS). */
function hosElapsed(driveHours, cfg) {
  const breaks = Math.floor(driveHours / cfg.hosDriveHours - 1e-9);
  return driveHours + Math.max(0, breaks) * cfg.hosBreakHours;
}

function permutations(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  arr.forEach((a, i) => {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) out.push([a, ...p]);
  });
  return out;
}

function toMs(v) {
  if (v === null || v === undefined || v === '') return null;
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * Build the cost model for one batch.
 * @param {{shipments:object[], carriers:object[], rate_table?:object[]}} payload
 * @param {{windows?:Object<string,{ready?:string,due?:string}>, config?:object}} [ctx]
 */
function createCostModel(payload, ctx = {}) {
  const cfg = { ...DEFAULTS, ...(ctx.config || {}) };
  const carriers = (payload.carriers || []).filter((c) => c && c.rate_per_mile > 0 && c.weight_cap_lbs > 0 && c.volume_cap_cuft > 0);
  const carrierById = new Map(carriers.map((c) => [String(c.id), c]));
  const windows = ctx.windows || {};

  // rate_table indexed by lane for the standalone (LTL / rated) quote.
  const ratesByLane = new Map();
  for (const r of payload.rate_table || []) {
    const k = `${r.origin_region}|${r.destination_region}`;
    if (!ratesByLane.has(k)) ratesByLane.set(k, []);
    ratesByLane.get(k).push(r);
  }

  // ── Per-shipment records ────────────────────────────────────────
  const recs = new Map();
  for (const s of payload.shipments || []) {
    const o = { lat: s.origin_lat, lon: s.origin_lon };
    const d = { lat: s.destination_lat, lon: s.destination_lon };
    const est = estMiles(o, d);
    const real = Number(s.distance_miles) > 0 ? Number(s.distance_miles) : est;
    const w = windows[String(s.id)] || {};
    recs.set(String(s.id), {
      id: String(s.id),
      weight: Number(s.weight_lbs),
      volume: Number(s.volume_cuft),
      o, d,
      oKey: pointKey(o.lat, o.lon),
      dKey: pointKey(d.lat, d.lon),
      miles: real,
      milesFactor: est > 1 ? real / est : 1,
      slaHours: Number(s.sla_hours) > 0 ? Number(s.sla_hours) : null,
      ready: toMs(w.ready),
      due: toMs(w.due),
      lane: `${s.origin_region}|${s.destination_region}`,
      originRegion: s.origin_region,
      destRegion: s.destination_region,
      originCity: s.origin_city,
      destCity: s.destination_city,
    });
  }

  // ── Standalone quotes (memoised) ────────────────────────────────
  const standaloneCache = new Map();
  function standalone(id) {
    if (standaloneCache.has(id)) return standaloneCache.get(id);
    const s = recs.get(id);
    let best = null;
    for (const c of carriers) {
      if (s.weight > c.weight_cap_lbs || s.volume > c.volume_cap_cuft) continue;
      const cost = (Number(c.base_fee) || 0) + c.rate_per_mile * s.miles;
      if (!best || cost < best.cost) best = { cost, carrier_id: String(c.id), mode: 'TL' };
    }
    for (const r of ratesByLane.get(s.lane) || []) {
      const c = carrierById.get(String(r.carrier_id));
      const capW = c ? c.weight_cap_lbs : cfg.ltlMaxWeightLbs;
      if (s.weight > capW || (c && s.volume > c.volume_cap_cuft)) continue;
      const linehaul = (Number(r.rate_per_lb) || 0) * s.weight + (Number(r.rate_per_cuft) || 0) * s.volume;
      const cost = Math.max(Number(r.minimum_charge) || 0, linehaul);
      if (cost > 0 && (!best || cost < best.cost)) best = { cost, carrier_id: String(r.carrier_id), mode: 'RATED' };
    }
    standaloneCache.set(id, best);
    return best;
  }

  /**
   * Price and check one candidate load (array of shipment ids).
   * @returns {object} { feasible, violations[], …metrics }
   */
  function evaluateLoad(ids) {
    const members = ids.map((id) => recs.get(String(id)));
    const violations = [];
    if (members.some((m) => !m)) return { feasible: false, violations: ['unknown shipment id'] };

    const weight = members.reduce((t, m) => t + m.weight, 0);
    const volume = members.reduce((t, m) => t + m.volume, 0);
    const quotes = members.map((m) => standalone(m.id));
    if (quotes.some((q) => !q)) violations.push('a member has no standalone price');
    const standaloneCost = quotes.reduce((t, q) => t + (q ? q.cost : 0), 0);

    if (members.length > cfg.maxShipmentsPerLoad) violations.push(`shipments ${members.length} > ${cfg.maxShipmentsPerLoad}`);

    const pickups = [...new Map(members.map((m) => [m.oKey, m.o])).entries()];
    const drops = [...new Map(members.map((m) => [m.dKey, m.d])).entries()];
    if (pickups.length > cfg.maxPickups) violations.push(`pickups ${pickups.length} > ${cfg.maxPickups}`);
    if (drops.length > cfg.maxDrops) violations.push(`drops ${drops.length} > ${cfg.maxDrops}`);

    const fitting = carriers.filter((c) => weight <= c.weight_cap_lbs && volume <= c.volume_cap_cuft);
    if (!fitting.length) violations.push(`no carrier fits ${Math.round(weight)} lb / ${Math.round(volume)} cu ft`);

    const base = { ids: members.map((m) => m.id), weight, volume, standaloneCost };
    if (violations.length) return { ...base, feasible: false, violations };

    const factor = members.reduce((t, m) => t + m.milesFactor, 0) / members.length;
    const longest = Math.max(...members.map((m) => m.miles));
    const start = members.every((m) => m.ready !== null) ? Math.max(...members.map((m) => m.ready)) : null;

    // Enumerate pickup order × drop order; keep sequences by mileage.
    const seqs = [];
    for (const pp of permutations(pickups)) {
      for (const dp of permutations(drops)) {
        const stops = [...pp.map(([k, p]) => ({ k, p, type: 'pickup' })), ...dp.map(([k, p]) => ({ k, p, type: 'drop' }))];
        let miles = 0;
        const cum = [0];
        for (let i = 1; i < stops.length; i++) {
          miles += estMiles(stops[i - 1].p, stops[i].p) * factor;
          cum.push(miles);
        }
        seqs.push({ stops, miles, cum });
      }
    }
    seqs.sort((a, b) => a.miles - b.miles);

    if (seqs[0].miles > cfg.maxDetourRatio * longest + 1e-6) {
      return { ...base, feasible: false, violations: [`route ${Math.round(seqs[0].miles)} mi > ${cfg.maxDetourRatio}× longest leg ${Math.round(longest)} mi`] };
    }

    // Cheapest carrier × shortest sequence that delivers everyone on time.
    const byCost = fitting
      .map((c) => ({ c, perMile: c.rate_per_mile, fee: Number(c.base_fee) || 0 }))
      .sort((a, b) => (a.fee + a.perMile * seqs[0].miles) - (b.fee + b.perMile * seqs[0].miles));

    let best = null;
    let lastLate = null;
    for (const seq of seqs) {
      if (seq.miles > cfg.maxDetourRatio * longest + 1e-6) break;
      for (const { c, perMile, fee } of byCost) {
        const mult = Number(c.transit_multiplier) > 0 ? Number(c.transit_multiplier) : 1;
        const late = lateMembers(members, seq, mult, start);
        if (late.length) { lastLate = late; continue; }
        const cost = fee + perMile * seq.miles;
        if (!best || cost < best.cost) best = { cost, carrier: c, seq };
        break; // carriers are cost-sorted for this mileage
      }
      if (best) break; // sequences are mileage-sorted
    }

    if (!best) {
      return { ...base, feasible: false, violations: [`service time: ${lastLate ? lastLate.join(', ') : 'members'} late on every sequence`] };
    }

    return {
      ...base,
      feasible: true,
      violations: [],
      carrier_id: String(best.carrier.id),
      cost: best.cost,
      savings: standaloneCost - best.cost,
      route_miles: best.seq.miles,
      sequence: best.seq.stops.map((s) => ({
        type: s.type,
        point: s.k,
        shipment_ids: members.filter((m) => (s.type === 'pickup' ? m.oKey : m.dKey) === s.k).map((m) => m.id),
      })),
    };
  }

  /** Members that miss their deadline on this sequence; [] when all on time. */
  function lateMembers(members, seq, mult, start) {
    const late = [];
    for (const m of members) {
      const dropIdx = seq.stops.findIndex((s) => s.type === 'drop' && s.k === m.dKey);
      const pickIdx = seq.stops.findIndex((s) => s.type === 'pickup' && s.k === m.oKey);
      const arrive = hosElapsed((seq.cum[dropIdx] / cfg.avgMph) * mult, cfg) + dropIdx * cfg.dwellHoursPerStop;
      if (m.due !== null && start !== null) {
        if (start + arrive * 3600000 > m.due) late.push(m.id);
      } else if (m.slaHours !== null) {
        // No absolute window: time on the truck from its own pickup.
        const picked = hosElapsed((seq.cum[pickIdx] / cfg.avgMph) * mult, cfg) + pickIdx * cfg.dwellHoursPerStop;
        if (arrive - picked > m.slaHours) late.push(m.id);
      }
    }
    return late;
  }

  return {
    config: cfg,
    carriersForCaps: carriers,
    ids: [...recs.keys()],
    record: (id) => recs.get(String(id)),
    standalone,
    evaluateLoad,
    hasWindows: [...recs.values()].some((r) => r.ready !== null && r.due !== null),
  };
}

module.exports = { createCostModel, DEFAULTS, _internals: { hosElapsed, permutations, haversine, estMiles } };
