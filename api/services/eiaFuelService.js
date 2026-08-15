// ═══════════════════════════════════════════════════════════════════
// EIA Fuel Price Service
// ─────────────────────────────────────────────────────────────────────
// Fetches the EIA U.S. National Average On-Highway Diesel price and
// caches it in the eia_fuel_prices table (migration 045) so rating
// never blocks on an external call.
//
// Sources, in preference order:
//   1. EIA Open Data API v2 (series EMD_EPD2D_PTE_NUS_DPG) — used only
//      when EIA_API_KEY is set in api/.env.
//   2. EIA public RSS feed (no key required) — the weekly Gasoline &
//      Diesel Fuel Update. The U.S. diesel price is parsed out of the
//      "On-Highway Diesel Fuel Retail Price" block.
//   3. Manual entry via POST /api/fsc/eia/manual (source='manual').
//
// EIA publishes the index every Monday; the cached row is considered
// fresh for STALE_AFTER_DAYS and re-fetched lazily after that.
// ═══════════════════════════════════════════════════════════════════

const { dbSelect, dbUpsert } = require('./supabase');

const EIA_RSS_URL = 'https://www.eia.gov/petroleum/gasdiesel/includes/gas_diesel_rss.xml';
const EIA_API_URL = 'https://api.eia.gov/v2/petroleum/pri/gnd/data/';
const EIA_DIESEL_SERIES = 'EMD_EPD2D_PTE_NUS_DPG'; // U.S. No 2 Diesel Retail, weekly
const STALE_AFTER_DAYS = 7;

/**
 * Parse the EIA RSS feed. The <description> CDATA lists regional prices;
 * the U.S. national diesel price is the first "N.NNN .. U.S." entry after
 * the "On-Highway Diesel Fuel Retail Price" heading. The item <title>
 * carries the data week: "Data For 07/06/26".
 *
 * @returns {{ price: number, priceDate: string }} priceDate is YYYY-MM-DD
 */
function parseRssDieselPrice(xml) {
  const dieselBlock = String(xml).split(/On-Highway\s+Diesel/i)[1];
  if (!dieselBlock) throw new Error('EIA RSS: diesel section not found');
  const priceMatch = dieselBlock.match(/([\d.]+)\s*\.{2,}?\s*U\.S\./i);
  if (!priceMatch) throw new Error('EIA RSS: U.S. diesel price not found');
  const price = parseFloat(priceMatch[1]);
  if (!Number.isFinite(price) || price <= 0) throw new Error('EIA RSS: unparsable price "' + priceMatch[1] + '"');

  const titleMatch = String(xml).match(/Data\s+For\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  let priceDate;
  if (titleMatch) {
    let [, mo, da, yr] = titleMatch;
    if (yr.length === 2) yr = '20' + yr;
    priceDate = `${yr}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`;
  } else {
    priceDate = new Date().toISOString().slice(0, 10);
  }
  return { price, priceDate };
}

async function fetchFromRss() {
  const res = await fetch(EIA_RSS_URL);
  if (!res.ok) throw new Error(`EIA RSS HTTP ${res.status}`);
  const xml = await res.text();
  const { price, priceDate } = parseRssDieselPrice(xml);
  return { price, priceDate, source: 'eia_rss' };
}

async function fetchFromApi(apiKey) {
  const url = EIA_API_URL +
    `?api_key=${encodeURIComponent(apiKey)}` +
    '&frequency=weekly&data[0]=value' +
    `&facets[series][]=${EIA_DIESEL_SERIES}` +
    '&sort[0][column]=period&sort[0][direction]=desc&length=1';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`EIA API HTTP ${res.status}`);
  const data = await res.json();
  const row = data?.response?.data?.[0];
  const price = parseFloat(row?.value);
  if (!row || !Number.isFinite(price) || price <= 0) throw new Error('EIA API: no diesel price in response');
  return { price, priceDate: row.period, source: 'eia_api' };
}

/** Fetch from the best available external source and cache the result. */
async function refreshDieselPrice() {
  let fetched;
  const apiKey = process.env.EIA_API_KEY;
  if (apiKey) {
    try {
      fetched = await fetchFromApi(apiKey);
    } catch (e) {
      console.warn('[eiaFuel] EIA API failed, falling back to RSS:', e.message);
    }
  }
  if (!fetched) fetched = await fetchFromRss();

  const row = await dbUpsert('eia_fuel_prices', {
    price_date: fetched.priceDate,
    price_usd_per_gallon: fetched.price,
    source: fetched.source,
    updated_at: new Date().toISOString(),
  }, 'price_date');
  console.log(`[eiaFuel] refreshed: $${fetched.price}/gal (week of ${fetched.priceDate}, ${fetched.source})`);
  return row;
}

/** Latest cached price row, or null when the table is empty. */
async function getLatestCached() {
  const rows = await dbSelect('eia_fuel_prices', {
    order: { col: 'price_date', asc: false },
    limit: 1,
  });
  return rows[0] || null;
}

function isStale(row) {
  if (!row) return true;
  const ageMs = Date.now() - new Date(row.price_date).getTime();
  return ageMs > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * The rating-side entry point: return the current diesel price, lazily
 * refreshing from EIA when the cache is empty/stale. A refresh failure
 * degrades to the stale cached row (rating keeps working offline);
 * only an empty cache + failed fetch returns null.
 *
 * @returns {Promise<{price_date, price_usd_per_gallon, source}|null>}
 */
async function getCurrentDieselPrice({ forceRefresh = false } = {}) {
  let cached = await getLatestCached();
  if (forceRefresh || isStale(cached)) {
    try {
      cached = await refreshDieselPrice();
    } catch (e) {
      console.warn('[eiaFuel] refresh failed:', e.message, cached ? '— using stale cache' : '— no cache available');
    }
  }
  return cached;
}

/** Manual price entry (Fuel Surcharge page fallback when EIA is unreachable). */
async function setManualPrice({ price, priceDate }) {
  const p = parseFloat(price);
  if (!Number.isFinite(p) || p <= 0) throw Object.assign(new Error('price must be a positive number ($/gal)'), { status: 400 });
  const date = priceDate || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Object.assign(new Error('priceDate must be YYYY-MM-DD'), { status: 400 });
  return dbUpsert('eia_fuel_prices', {
    price_date: date,
    price_usd_per_gallon: p,
    source: 'manual',
    updated_at: new Date().toISOString(),
  }, 'price_date');
}

module.exports = {
  getCurrentDieselPrice,
  refreshDieselPrice,
  setManualPrice,
  getLatestCached,
  // exported for unit tests
  parseRssDieselPrice,
};
