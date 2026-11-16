// ════════════════════════════════════════════════════════════════════
// shipments.js — read-only shipment + audit-history tools.
//   search_shipments  GET /api/shipments             (latest 500)
//   get_shipment      GET /api/shipments?id=<id>
//   get_history       GET /api/{orders|shipments}/:id/history
// ════════════════════════════════════════════════════════════════════

const { z } = require('zod');
const { pick, compact, matchesText, equalsCi, safeHandler } = require('./format');
const { READ_ONLY } = require('./orders');
const { ZoreeApiError } = require('../services/zoreeApiClient');

const SHIPMENT_SUMMARY_FIELDS = [
  'id', 'status', 'carrier', 'mode', 'equipment',
  'origin', 'origin_zip', 'ship_from_name', 'dest', 'dest_zip', 'ship_to_name',
  'pickup_date', 'delivery_date', 'total_cost', 'order_ids', 'master_shipment_id',
  'bol_type', 'created_at',
];

const SEARCH_FIELDS = ['id', 'carrier', 'origin', 'dest', 'ship_from_name', 'ship_to_name',
  'master_shipment_id', 'order_ids', 'commodity'];

// Columns selected by api/services/changeHistory.js getHistory().
const HISTORY_FIELDS = ['created_at', 'action', 'field', 'old_value', 'new_value',
  'username', 'user_role', 'metadata'];

async function searchShipments(api, { query, status, carrier, mode, limit = 25 }) {
  const data = await api.get('/api/shipments');
  const rows = (data && data.shipments) || [];
  const matched = rows.filter((s) =>
    (!status || equalsCi(s.status, status))
    && (!carrier || matchesText(s, carrier, ['carrier', 'scac']))
    && (!mode || equalsCi(s.mode, mode))
    && matchesText(s, query, SEARCH_FIELDS));
  return {
    total_matched: matched.length,
    returned: Math.min(matched.length, limit),
    scanned: rows.length,
    note: rows.length >= 500 ? 'Search covers the 500 most recent shipments.' : undefined,
    shipments: matched.slice(0, limit).map((s) => pick(s, SHIPMENT_SUMMARY_FIELDS)),
  };
}

async function getShipment(api, { shipment_id }) {
  const data = await api.get('/api/shipments', { id: shipment_id });
  const row = data && Array.isArray(data.shipments) ? data.shipments[0] : null;
  if (!row) throw new ZoreeApiError(404, `Shipment ${shipment_id} not found`);
  return { shipment: compact(row) };
}

async function getHistory(api, { entity, id, limit = 50 }) {
  const base = entity === 'shipment' ? '/api/shipments' : '/api/orders';
  const data = await api.get(`${base}/${encodeURIComponent(id)}/history`, { limit });
  const rows = (data && data.rows) || [];
  return {
    entity,
    id,
    total: rows.length,
    changes: rows.map((r) => pick(r, HISTORY_FIELDS)),
  };
}

function registerShipmentTools(server, api) {
  server.registerTool('search_shipments', {
    title: 'Search shipments',
    description: 'Find ZoreeTMS shipments by free text (shipment id, carrier, city, order id) and/or '
      + 'exact status, carrier or mode. Returns compact summaries, newest first.',
    inputSchema: {
      query: z.string().optional().describe('Free text matched against id, carrier, origin/destination, order ids'),
      status: z.string().optional().describe('Exact shipment status, e.g. Planned, Tendered, Accepted, In Transit, Delivered'),
      carrier: z.string().optional().describe('Carrier name or SCAC (partial match)'),
      mode: z.string().optional().describe('TL, LTL, ...'),
      limit: z.number().int().min(1).max(100).optional().describe('Max rows to return (default 25)'),
    },
    annotations: { title: 'Search shipments', ...READ_ONLY },
  }, safeHandler((args) => searchShipments(api, args)));

  server.registerTool('get_shipment', {
    title: 'Get shipment',
    description: 'Get every field of one ZoreeTMS shipment (carrier, stops, dates, cost, linked orders).',
    inputSchema: { shipment_id: z.string().min(1).describe('Shipment id') },
    annotations: { title: 'Get shipment', ...READ_ONLY },
  }, safeHandler((args) => getShipment(api, args)));

  server.registerTool('get_history', {
    title: 'Get change history',
    description: 'Audit trail for an order or shipment: who changed which field, from what, to what, and when.',
    inputSchema: {
      entity: z.enum(['order', 'shipment']).describe('Which kind of record'),
      id: z.string().min(1).describe('Order id or shipment id'),
      limit: z.number().int().min(1).max(500).optional().describe('Max changes to return (default 50)'),
    },
    annotations: { title: 'Get change history', ...READ_ONLY },
  }, safeHandler((args) => getHistory(api, args)));
}

module.exports = { registerShipmentTools, searchShipments, getShipment, getHistory };
