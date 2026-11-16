// ════════════════════════════════════════════════════════════════════
// rating.js — carriers, LTL quotes, fuel and mileage (all read-only).
//   list_carriers       GET  /api/carriers
//   quote_ltl           POST /api/ltl/quote        (CzarLite + FSC + transit)
//   get_diesel_price    GET  /api/fsc/eia/current
//   estimate_miles      GET  /api/mileage/estimate (ZIP-to-ZIP haversine)
// ════════════════════════════════════════════════════════════════════

const { z } = require('zod');
const { pick, matchesText, equalsCi, safeHandler } = require('./format');
const { READ_ONLY } = require('./orders');

const CARRIER_FIELDS = ['id', 'name', 'scac', 'mode', 'status', 'mc_number', 'dot_number',
  'contact_name', 'contact_email', 'phone', 'czarlite_enabled', 'carrierconnect_enabled', 'eia_fsc_enabled'];

// Field names as produced by POST /api/ltl/quote in api/server.js.
const QUOTE_FIELDS = ['carrier', 'scac', 'serviceLevel', 'totalCharge', 'czarBaseGross', 'discountPct',
  'discountAmt', 'czarBase', 'fscCharge', 'fscPct', 'fscSource', 'billedWeight', 'transitDays', 'deliveryDate'];

const zip = z.string().regex(/^\d{5}(-\d{4})?$/, '5-digit US ZIP');

async function listCarriers(api, { query, mode, status, limit = 50 }) {
  const data = await api.get('/api/carriers');
  const rows = (data && data.carriers) || [];
  const matched = rows.filter((c) =>
    (!mode || equalsCi(c.mode, mode))
    && (!status || equalsCi(c.status, status))
    && matchesText(c, query, ['name', 'scac', 'mc_number', 'dot_number']));
  return {
    total_matched: matched.length,
    carriers: matched.slice(0, limit).map((c) => pick(c, CARRIER_FIELDS)),
  };
}

async function quoteLtl(api, { origin_zip, dest_zip, weight, freight_class }) {
  const data = await api.post('/api/ltl/quote', {
    originZip: origin_zip,
    destZip: dest_zip,
    weight,
    freightClass: freight_class,
  });
  const quotes = (data && data.quotes) || [];
  return {
    lane: `${data.originZip} → ${data.destZip}`,
    weight_lbs: data.weight,
    freight_class: data.freightClass,
    quote_count: quotes.length,
    cheapest: quotes[0] ? pick(quotes[0], QUOTE_FIELDS) : null,
    quotes: quotes.map((q) => pick(q, QUOTE_FIELDS)),
    generated_at: data.generatedAt,
  };
}

async function getDieselPrice(api) {
  const data = await api.get('/api/fsc/eia/current');
  return { eia_diesel: data && data.eia };
}

async function estimateMiles(api, { origin_zip, dest_zip }) {
  return api.get('/api/mileage/estimate', { originZip: origin_zip, destZip: dest_zip });
}

function registerRatingTools(server, api) {
  server.registerTool('list_carriers', {
    title: 'List carriers',
    description: 'List carriers in ZoreeTMS with SCAC, mode, status and integration flags. Filter by name/SCAC text, mode or status.',
    inputSchema: {
      query: z.string().optional().describe('Name, SCAC, MC # or DOT # (partial match)'),
      mode: z.string().optional().describe('TL, LTL, ...'),
      status: z.string().optional().describe('Active, Inactive, ...'),
      limit: z.number().int().min(1).max(200).optional().describe('Max rows (default 50)'),
    },
    annotations: { title: 'List carriers', ...READ_ONLY },
  }, safeHandler((args) => listCarriers(api, args)));

  server.registerTool('quote_ltl', {
    title: 'Quote LTL',
    description: 'Rate an LTL shipment across every CzarLite-enabled carrier: base rate, discount, '
      + 'EIA-indexed fuel surcharge, total and transit days. Sorted cheapest first. Does not create or tender anything.',
    inputSchema: {
      origin_zip: zip.describe('Origin ZIP'),
      dest_zip: zip.describe('Destination ZIP'),
      weight: z.number().positive().max(45000).describe('Total weight in lbs'),
      freight_class: z.number().min(50).max(500).optional().describe('NMFC class, e.g. 70, 77.5, 85 (default 70)'),
    },
    annotations: { title: 'Quote LTL', ...READ_ONLY, idempotentHint: false, openWorldHint: true },
  }, safeHandler((args) => quoteLtl(api, args)));

  server.registerTool('get_diesel_price', {
    title: 'Get diesel price',
    description: 'Latest U.S. on-highway diesel price (EIA weekly) that ZoreeTMS uses for fuel surcharges.',
    inputSchema: {},
    annotations: { title: 'Get diesel price', ...READ_ONLY },
  }, safeHandler(() => getDieselPrice(api)));

  server.registerTool('estimate_miles', {
    title: 'Estimate miles',
    description: 'Quick straight-line-based mileage estimate between two US ZIPs (not billing-grade PC*MILER miles).',
    inputSchema: { origin_zip: zip.describe('Origin ZIP'), dest_zip: zip.describe('Destination ZIP') },
    annotations: { title: 'Estimate miles', ...READ_ONLY },
  }, safeHandler((args) => estimateMiles(api, args)));
}

module.exports = { registerRatingTools, listCarriers, quoteLtl, getDieselPrice, estimateMiles };
