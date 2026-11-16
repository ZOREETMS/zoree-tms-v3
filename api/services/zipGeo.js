// ═══════════════════════════════════════════════════════════════════
// ZIP Geo Lookup — api/services/zipGeo.js
// ─────────────────────────────────────────────────────────────────────
// Reads public.zip_geo (migration 046, seeded by
// api/scripts/seedZipGeo.js) and hands quantumEngineMapper the
// synchronous resolveGeo(zip) it expects.
//
// The table is static reference data (~41k rows, ~4 MB resident), so it
// is loaded once and cached for the process lifetime rather than joined
// per batch — a consolidation run touches thousands of zips and a
// per-row round trip would dominate the request.
//
// Deliberately NOT lazy inside resolveGeo: the mapper is synchronous by
// design (pure, unit-testable), so callers must `await load()` once
// before mapping. Calling resolveGeo before load() throws rather than
// silently returning null, because a null there looks identical to
// "unknown zip" and would quietly shrink the batch.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const { getClient } = require('./supabase');

const PAGE = 1000;
let cache = null;      // Map<zip, {lat,lng,city,state}>
let loading = null;    // in-flight promise, so concurrent callers share one load

async function fetchAll(tenantConfig) {
  const db = getClient(tenantConfig);
  const map = new Map();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('zip_geo')
      .select('zip,lat,lng,city,state')
      .order('zip', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`[DB] zip_geo select failed: ${error.message}`);
    for (const r of data || []) {
      map.set(String(r.zip), {
        lat: Number(r.lat), lng: Number(r.lng),
        city: r.city || '', state: r.state || '',
      });
    }
    if (!data || data.length < PAGE) break;
  }
  return map;
}

/** Load (once) and cache the zip table. Safe to call repeatedly. */
function load(tenantConfig = null) {
  if (cache) return Promise.resolve(cache);
  if (!loading) {
    loading = fetchAll(tenantConfig)
      .then((m) => {
        if (m.size === 0) {
          throw new Error('zip_geo is empty — run `node api/scripts/seedZipGeo.js` before mapping');
        }
        cache = m;
        loading = null;
        return cache;
      })
      .catch((err) => { loading = null; throw err; });
  }
  return loading;
}

/**
 * Synchronous lookup for quantumEngineMapper.toEngineShipments.
 * Normalises ZIP+4 ("60601-1234") and pads short numeric zips.
 * @returns {{lat,lng,city,state}|null} null = genuinely unknown zip
 */
function resolveGeo(zip) {
  if (!cache) throw new Error('zipGeo.load() must be awaited before resolveGeo()');
  if (zip === null || zip === undefined) return null;
  let z = String(zip).trim();
  if (!z) return null;
  const dash = z.indexOf('-');
  if (dash > 0) z = z.slice(0, dash);
  if (!/^\d+$/.test(z)) return null;      // e.g. the 'WEIUHBJF' row in orders
  if (z.length < 5) z = z.padStart(5, '0');
  if (z.length > 5) z = z.slice(0, 5);
  return cache.get(z) || null;
}

/** Region resolver for toEngineRateTable — accepts {zip} or {text}. */
function regionOf({ zip, text } = {}) {
  const { regionForState } = require('../constants/usRegions');
  const hit = zip ? resolveGeo(zip) : null;
  if (hit) return regionForState(hit.state);
  // Fall back to a trailing two-letter state in free text ("Chicago, IL").
  const m = text && String(text).match(/([A-Za-z]{2})\s*$/);
  return m ? regionForState(m[1]) : null;
}

function isLoaded() { return !!cache; }
function size() { return cache ? cache.size : 0; }
function _reset() { cache = null; loading = null; }   // tests only

module.exports = { load, resolveGeo, regionOf, isLoaded, size, _reset };
