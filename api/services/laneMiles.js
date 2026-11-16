// ═══════════════════════════════════════════════════════════════════
// Lane Miles — api/services/laneMiles.js
//
// Estimated road miles for a lane when the rate row carries no mileage.
// Same method the bulk-plan rate shop falls back to (straight-line
// distance × 1.2 road factor), but resolved from the full 5-digit
// public.zip_geo table instead of 3-digit centroids.
//
// The math (zipOf, haversine, roadMiles) is pure; estimateLaneMiles
// does the two-row zip_geo lookup.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const ROAD_FACTOR = 1.2;
const EARTH_RADIUS_MI = 3959;

// "ASHCAMP, KY 41512" -> "41512"; ZIP+4 is trimmed; null when no ZIP.
function zipOf(location) {
  const m = String(location ?? '').match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : null;
}

function haversine(lat1, lng1, lat2, lng2) {
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return EARTH_RADIUS_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Road-mile estimate between two {lat,lng} points; null if either is missing.
function roadMiles(o, d) {
  const ok = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));
  if (!ok(o) || !ok(d)) return null;
  return Math.max(1, Math.round(haversine(Number(o.lat), Number(o.lng), Number(d.lat), Number(d.lng)) * ROAD_FACTOR));
}

/**
 * @param {object} db      Supabase client
 * @param {string} origin  location text containing a 5-digit ZIP
 * @param {string} dest    location text containing a 5-digit ZIP
 * @returns {Promise<number|null>} estimated road miles, or null when a ZIP
 *          is missing from the text or from zip_geo
 */
async function estimateLaneMiles(db, origin, dest) {
  const oz = zipOf(origin);
  const dz = zipOf(dest);
  if (!oz || !dz) return null;
  const { data, error } = await db.from('zip_geo').select('zip,lat,lng').in('zip', [oz, dz]);
  if (error) throw new Error(`[DB] zip_geo select failed: ${error.message}`);
  const byZip = new Map((data || []).map((r) => [String(r.zip), r]));
  return roadMiles(byZip.get(oz), byZip.get(dz));
}

module.exports = { ROAD_FACTOR, zipOf, haversine, roadMiles, estimateLaneMiles };
