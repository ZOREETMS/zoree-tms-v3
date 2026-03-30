/**
 * HERE Maps API key — same source as Live Tracking (HERE JS SDK).
 * Set `VITE_HERE_API_KEY` in frontend/.env, or `window.ZOREE_HERE_API_KEY` for quick tests.
 */
export function getHereApiKey() {
  const fromEnv = import.meta.env.VITE_HERE_API_KEY;
  const fromWin = typeof window !== "undefined" ? window.ZOREE_HERE_API_KEY : "";
  return String(fromEnv || fromWin || "").trim();
}

/** Prefer env; optional fallback for local dev (use your own key in production). */
export function resolveHereApiKey() {
  return getHereApiKey() || "zAN1Ew81w46BFqHj9whubZBtRRU2AuPlmV2yVPxMRRE";
}

/**
 * HERE Raster Tile API v3 for Leaflet.
 * Map Tile v2 (`*.base.maps.ls.hereapi.com/maptile/2.1/...`) returns 410 Gone for new keys — do not use.
 */
export function hereRasterTileUrl(apiKey) {
  const k = encodeURIComponent(apiKey);
  return `https://maps.hereapi.com/v3/base/mc/{z}/{x}/{y}/png8?apikey=${k}&style=explore.day&size=256&lang=en`;
}
