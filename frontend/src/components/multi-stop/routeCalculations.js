/**
 * Haversine formula — great-circle distance between two lat/lng points.
 * Returns distance in miles.
 */
export function haversine(lat1, lng1, lat2, lng2) {
  const R = 3959; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calculate miles between two stops using haversine × 1.3 road factor.
 * Returns 0 if either stop lacks lat/lng.
 */
export function calcLegMiles(a, b) {
  if (a.lat && a.lng && b.lat && b.lng) {
    return Math.round(haversine(a.lat, a.lng, b.lat, b.lng) * 1.3);
  }
  return 0;
}

/**
 * Estimate transit hours from miles at 50 mph average truck speed.
 */
export function calcLegTransitHours(miles) {
  if (!miles) return 0;
  const AVG_MPH = 50;
  return Math.round((miles / AVG_MPH) * 10) / 10;
}

/**
 * Sum total route miles across all consecutive stop pairs.
 */
export function calcTotalMiles(stops) {
  let total = 0;
  for (let i = 1; i < stops.length; i++) {
    total += calcLegMiles(stops[i - 1], stops[i]);
  }
  return Math.round(total);
}
