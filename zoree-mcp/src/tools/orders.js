// ════════════════════════════════════════════════════════════════════
// orders.js — read-only order tools.
//   search_orders  GET /api/orders            (latest 500, filtered here)
//   get_order      GET /api/orders/:id/full   (order + lines)
//   count_orders   GET /api/orders/count      (true count, not capped)
// ════════════════════════════════════════════════════════════════════

const { z } = require('zod');
const { pick, compact, matchesText, equalsCi, safeHandler } = require('./format');

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const ORDER_SUMMARY_FIELDS = [
  'id', 'customer', 'status', 'ship_mode', 'service_level',
  'origin', 'origin_zip', 'ship_from_name', 'destination', 'dest_zip', 'ship_to_name',
  'weight', 'pieces', 'commodity', 'hazmat',
  'readyDate', 'dueDate', 'shipmentId', 'ref_num', 'po_number', 'preferredCarrier', 'createdAt',
];

const SEARCH_FIELDS = ['id', 'customer', 'origin', 'destination', 'ship_from_name', 'ship_to_name',
  'ref_num', 'po_number', 'commodity', 'shipmentId', 'notes'];

const ORDER_LINE_FIELDS = ['line_num', 'item_id', 'item_name', 'description', 'quantity', 'qty',
  'uom', 'weight', 'freight_class', 'nmfc', 'pieces', 'length', 'width', 'height', 'hazmat'];

async function searchOrders(api, { query, status, customer, ship_mode, limit = 25 }) {
  const data = await api.get('/api/orders');
  const rows = (data && data.orders) || [];
  const matched = rows.filter((o) =>
    (!status || equalsCi(o.status, status))
    && (!customer || matchesText(o, customer, ['customer']))
    && (!ship_mode || equalsCi(o.ship_mode, ship_mode))
    && matchesText(o, query, SEARCH_FIELDS));
  return {
    total_matched: matched.length,
    returned: Math.min(matched.length, limit),
    scanned: rows.length,
    note: rows.length >= 500 ? 'Search covers the 500 most recent orders.' : undefined,
    orders: matched.slice(0, limit).map((o) => pick(o, ORDER_SUMMARY_FIELDS)),
  };
}

async function getOrder(api, { order_id }) {
  const order = await api.get(`/api/orders/${encodeURIComponent(order_id)}/full`);
  const lines = Array.isArray(order.lines) ? order.lines : [];
  const { lines: _drop, ...header } = order;
  return {
    order: compact(header),
    lines: lines.map((l) => {
      const picked = pick(l, ORDER_LINE_FIELDS);
      return Object.keys(picked).length ? picked : compact(l);
    }),
  };
}

async function countOrders(api, { status, customer }) {
  const data = await api.get('/api/orders/count', { status, customer });
  return { total: data.total, filters: compact({ status, customer }) };
}

function registerOrderTools(server, api) {
  server.registerTool('search_orders', {
    title: 'Search orders',
    description: 'Find ZoreeTMS orders by free text (order id, customer, city, ref #, PO #, commodity) '
      + 'and/or exact status, customer or ship mode. Returns compact order summaries, newest first. '
      + 'Use get_order for full detail and order lines.',
    inputSchema: {
      query: z.string().optional().describe('Free text matched against id, customer, origin/destination, ref #, PO #, commodity, shipment id'),
      status: z.string().optional().describe('Exact order status, e.g. Unplanned, Planned, Tendered, In Transit, Delivered, Cancelled'),
      customer: z.string().optional().describe('Customer name (partial match)'),
      ship_mode: z.string().optional().describe('TL, LTL, Parcel, Intermodal, ...'),
      limit: z.number().int().min(1).max(100).optional().describe('Max rows to return (default 25)'),
    },
    annotations: { title: 'Search orders', ...READ_ONLY },
  }, safeHandler((args) => searchOrders(api, args)));

  server.registerTool('get_order', {
    title: 'Get order',
    description: 'Get one ZoreeTMS order with all header fields and its order lines.',
    inputSchema: { order_id: z.string().min(1).describe('Order id, e.g. ORD-10023') },
    annotations: { title: 'Get order', ...READ_ONLY },
  }, safeHandler((args) => getOrder(api, args)));

  server.registerTool('count_orders', {
    title: 'Count orders',
    description: 'Exact number of orders in ZoreeTMS, optionally filtered by status and/or customer. '
      + 'Use this for totals and KPIs — search_orders only scans the 500 most recent orders.',
    inputSchema: {
      status: z.string().optional().describe('Exact order status'),
      customer: z.string().optional().describe('Exact customer name'),
    },
    annotations: { title: 'Count orders', ...READ_ONLY },
  }, safeHandler((args) => countOrders(api, args)));
}

module.exports = { registerOrderTools, searchOrders, getOrder, countOrders, READ_ONLY };
