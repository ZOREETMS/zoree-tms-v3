// ═══════════════════════════════════════════════════════════════════
// TL quote service — prices a truckload lane against contract rates.
//
// Same pricing the bulk-plan rate shop uses (/api/bulk-plan/rate TL
// branch): rate-per-mile × miles, plus fuel surcharge from the carrier's
// EIA bracket schedule when the carrier is opted in (migration 045),
// else the static % on the rate row. priceTlRate is shared with that
// route so the two can never drift.
//
// Rates go through rateMatcher (status + eff/exp filter, geo ladder).
// ═══════════════════════════════════════════════════════════════════

'use strict';

const db = require('../supabase');
const { fetchAllRows } = require('../db/pagedRead');
const { matchAllRates } = require('../rateMatcher');
const { getCurrentDieselPrice } = require('../eiaFuelService');
const { getSchedulesByCarrier, lookupFscPct } = require('../fscSchedule');
const { zipOf, roadMiles } = require('../laneMiles');

const RATE_CACHE_MS = 5 * 60 * 1000;
let _rates = { at: 0, rows: [] };

const parseMoney = (v) => parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, '')) || 0;
const parsePct = parseMoney;

/** TL price for one rate. Rounds like the bulk-plan rate shop. */
function priceTlRate({ rpm, miles, fscPct }) {
  const base = Math.round(rpm * miles);
  const fsc = Math.round(base * ((fscPct || 0) / 100));
  return { base, fsc, total: base + fsc };
}

function serviceHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function loadActiveTlRates() {
  if (Date.now() - _rates.at < RATE_CACHE_MS && _rates.rows.length) return _rates.rows;
  const rows = await fetchAllRows(
    `${process.env.SUPABASE_URL}/rest/v1/rates?mode=eq.TL&status=eq.Active&select=` +
      'id,carrier,origin,dest,rate,unit,fsc,eff,exp,status,transit_days,lane,service_level,miles,' +
      'match_type,origin_zip,dest_zip,origin_country,dest_country,equipment',
    { headers: serviceHeaders() }
  );
  _rates = { at: Date.now(), rows };
  return rows;
}

/** Active carriers keyed by UPPERCASE name (migration 022 canonical form). */
async function loadCarriers() {
  const rows = await db.dbSelect('carriers', { filters: [['status', 'eq', 'Active']], limit: 500 });
  return new Map(rows.map((c) => [String(c.name || '').toUpperCase(), c]));
}

async function loadFuelContext(carriers) {
  const eiaIds = [...carriers.values()].filter((c) => c.eia_fsc_enabled).map((c) => c.id);
  if (!eiaIds.length) return { diesel: null, schedules: {} };
  try {
    const [priceRow, schedules] = await Promise.all([getCurrentDieselPrice(), getSchedulesByCarrier(eiaIds)]);
    return {
      diesel: priceRow ? { price: parseFloat(priceRow.price_usd_per_gallon), week: priceRow.price_date } : null,
      schedules: schedules || {},
    };
  } catch (err) {
    console.warn('[tlQuote] EIA fuel context failed — static rate FSC used:', err.message);
    return { diesel: null, schedules: {} };
  }
}

/** "Chicago, IL 60632" → { city:'CHICAGO', state:'IL', zip:'60632' } */
function parsePlace(text) {
  const s = String(text || '');
  const zip = zipOf(s);
  const [cityPart, rest = ''] = s.split(',');
  const state = (rest.match(/\b([A-Za-z]{2})\b/) || [])[1];
  return { city: (cityPart || '').replace(/\d{5}/g, '').trim().toUpperCase() || null, state: state ? state.toUpperCase() : null, zip };
}

async function geoFor(place) {
  if (place.zip) {
    const rows = await db.dbSelect('zip_geo', { select: 'zip,lat,lng', filters: [['zip', 'eq', place.zip]], limit: 1 });
    if (rows[0]) return rows[0];
  }
  if (place.city && place.state) {
    const rows = await db.dbSelect('zip_geo', { select: 'zip,lat,lng', filters: [['city', 'ilike', place.city], ['state', 'eq', place.state]], limit: 1 });
    if (rows[0]) return rows[0];
  }
  return null;
}

/** Estimated road miles from zip_geo (ZIP first, then city+state). */
async function resolveLaneMiles(origin, dest) {
  try {
    const [o, d] = await Promise.all([geoFor(parsePlace(origin)), geoFor(parsePlace(dest))]);
    return roadMiles(o, d);
  } catch (err) {
    console.warn('[tlQuote] lane miles lookup failed:', err.message);
    return null;
  }
}

function fscFor(rate, carrier, fuel) {
  const eiaPct = carrier && carrier.eia_fsc_enabled && fuel.diesel
    ? lookupFscPct(fuel.schedules[carrier.id], fuel.diesel.price)
    : null;
  return eiaPct != null ? { pct: eiaPct, source: 'eia' } : { pct: parsePct(rate.fsc), source: 'rate' };
}

/**
 * Price a TL lane.
 * @param {object} lane { origin, dest, weight?, asOf? }
 * @returns {Promise<{quotes:object[], laneMiles:number|null, diesel:object|null, candidates:number}>}
 */
async function quoteLane({ origin, dest, weight = 0, asOf } = {}) {
  const [rates, carriers, laneMiles] = await Promise.all([loadActiveTlRates(), loadCarriers(), resolveLaneMiles(origin, dest)]);
  const fuel = await loadFuelContext(carriers);
  const o = parsePlace(origin);
  const d = parsePlace(dest);
  const ctx = { originCity: origin, destCity: dest, originZip: o.zip, destZip: d.zip, asOf };

  const byCarrier = new Map();
  for (const r of rates) {
    const k = String(r.carrier || '').toUpperCase();
    if (!byCarrier.has(k)) byCarrier.set(k, []);
    byCarrier.get(k).push(r);
  }

  const quotes = [];
  for (const [name, carrierRates] of byCarrier) {
    const carrier = carriers.get(name);
    if (!carrier) continue; // inactive or unknown carrier
    if (weight && carrier.max_weight && Number(weight) > Number(carrier.max_weight)) continue;
    const { rates: matched } = matchAllRates(ctx, carrierRates);
    for (const { rate, reason } of matched) {
      const rpm = parseMoney(rate.rate);
      if (!rpm) continue; // $0 placeholder rows never price freight
      const miles = Number(rate.miles) || laneMiles;
      if (!miles) continue;
      const fsc = fscFor(rate, carrier, fuel);
      const price = priceTlRate({ rpm, miles, fscPct: fsc.pct });
      quotes.push({
        carrier: carrier.name, carrierId: carrier.id, scac: carrier.scac || null,
        rateId: rate.id, rpm, miles, milesSource: rate.miles ? 'rate' : 'zip_geo',
        base: price.base, fscPct: fsc.pct, fscSource: fsc.source, fsc: price.fsc, total: price.total,
        transitDays: rate.transit_days || null, serviceLevel: rate.service_level || null,
        equipment: rate.equipment || null, matchReason: reason,
        onTimePct: carrier.on_time_pct, claimRatio: carrier.claim_ratio,
      });
    }
  }
  quotes.sort((a, b) => a.total - b.total);
  return { quotes, laneMiles, diesel: fuel.diesel, candidates: rates.length };
}

module.exports = { quoteLane, priceTlRate, parsePlace, resolveLaneMiles, parseMoney, loadCarriers };
