// ════════════════════════════════════════════════════════════════════
// planning.js — rate and plan a single order, the way the Plan modal does.
//
//   rate_order  (read-only)
//     1. GET  /api/orders/:id/full     origin/dest, ZIPs, weight, ready/due,
//                                      freight class from the order lines
//     2. POST /api/bulk-plan/rate      same engine as the Plan modal:
//                                      LTL (CzarLite) + TL (rate table),
//                                      fuel, miles, transit, lane prefs
//     3. services/planDates.js         pickup / delivery / meets-due-date
//
//   plan_order  (WRITE — creates a shipment)
//     rate as above → pick the requested carrier → build the same plan
//     object OrdersPage.confirmPlan builds → POST /api/bulk-plan/execute.
//     The server enforces admin/planner role and writes the change
//     history (shipment 'create' + order 'plan' rows), exactly as for a
//     plan made in the web app. Dock-door reservation is client-side in
//     the web app (dockService.assignDockToPlan) and is NOT done here;
//     pickup time defaults to 06:00 like the modal's no-dock path.
// ════════════════════════════════════════════════════════════════════

const { z } = require('zod');
const { compact, safeHandler } = require('./format');
const { READ_ONLY } = require('./orders');
const { calcDates } = require('../services/planDates');
const { ZoreeApiError } = require('../services/zoreeApiClient');

const DEFAULT_PICKUP_TIME = '06:00';

function freightClassFromLines(lines) {
  const classes = (lines || [])
    .map((l) => Number(l.freight_class || l.nmfc_class || l.class))
    .filter((n) => Number.isFinite(n) && n > 0);
  // Highest class on the order drives the rate, as on a mixed-class BOL.
  return classes.length ? Math.max(...classes) : null;
}

/** Order + lane + raw quotes from the Plan modal's rating engine. */
async function fetchOrderQuotes(api, { order_id, freight_class, optimize_by = 'cost' }) {
  const order = await api.get(`/api/orders/${encodeURIComponent(order_id)}/full`);
  const lineClass = freightClassFromLines(order.lines);
  const fc = freight_class || lineClass || 70;
  const lane = {
    laneKey: order.id,
    origin: order.origin,
    destination: order.dest,
    originZip: order.origin_zip,
    destZip: order.dest_zip,
    totalWeight: Number(order.weight) || 0,
    totalPieces: Number(order.pieces) || 0,
    freightClass: fc,
    orderIds: [order.id],
  };
  const data = await api.post('/api/bulk-plan/rate', { lanes: [lane], optimizeBy: optimize_by });
  const result = (data && data.results && data.results[0]) || {};
  if (result.error) throw new Error(result.error);
  return {
    order,
    lane,
    loadType: result.loadType,
    quotes: result.quotes || [],
    freightClass: fc,
    freightClassSource: freight_class ? 'input' : (lineClass ? 'order lines' : 'default 70'),
  };
}

function datesFor(q, order) {
  return calcDates({ transitDays: q.transitDays, readyDate: order.ready, dueDate: order.due });
}

function shapeQuote(q, order) {
  const dates = datesFor(q, order);
  return compact({
    carrier: q.carrier,
    scac: q.scac,
    mode: q.mode,
    service: q.serviceLevel,
    equipment: q.equipment,
    total: q.totalCharge,
    base: q.czarBaseGross,
    discount_pct: q.discountPct || undefined,
    fuel: q.fscCharge,
    fuel_pct: q.fscPct,
    fuel_source: q.fscSource,
    miles: q.miles,
    transit_days: q.transitDays,
    transit_estimated: q.transitEstimated || undefined,
    pickup: dates.pickup,
    delivery: dates.delivery,
    meets_due_date: dates.meetsDueDate,
    recommended: q.recommended || undefined,
    preferred: q.preferred || undefined,
    infeasible: q.infeasible || undefined,
  });
}

function orderSummary(order) {
  return compact({
    id: order.id,
    customer: order.customer,
    lane: `${order.origin} → ${order.dest}`,
    weight_lbs: order.weight,
    pieces: order.pieces,
    ready: order.ready,
    due: order.due,
    status: order.status,
  });
}

async function rateOrder(api, args) {
  const r = await fetchOrderQuotes(api, args);
  const options = r.quotes.map((q) => shapeQuote(q, r.order));
  return {
    order: orderSummary(r.order),
    load_type: r.loadType,
    freight_class: r.freightClass,
    freight_class_source: r.freightClassSource,
    sorted_by: args.optimize_by === 'transit' ? 'transit' : 'cost',
    option_count: options.length,
    options,
  };
}

/** Match by carrier name (partial, case-insensitive) or exact SCAC, optionally by mode. */
function pickQuote(quotes, carrier, mode) {
  const c = String(carrier || '').trim().toLowerCase();
  const m = mode ? String(mode).toUpperCase() : null;
  return quotes.filter((q) => (!m || String(q.mode).toUpperCase() === m)
    && (String(q.scac || '').toLowerCase() === c || String(q.carrier || '').toLowerCase().includes(c)));
}

/** Same shape OrdersPage.confirmPlan sends (no-dock path). */
function buildPlan(lane, q, dates) {
  return {
    laneKey: lane.laneKey,
    origin: lane.origin,
    destination: lane.destination,
    originZip: lane.originZip,
    destZip: lane.destZip,
    totalWeight: lane.totalWeight,
    totalPieces: lane.totalPieces,
    orderIds: lane.orderIds,
    carrier: q.carrier || '',
    mode: q.mode || 'LTL',
    totalCost: q.totalCharge || 0,
    pickupDate: dates.pickup,
    deliveryDate: dates.delivery,
    czarliteRate: q.mode === 'LTL',
    serviceLevel: q.serviceLevel || '',
    miles: q.miles || null,
    rate: q.czarBaseGross || q.czarBase || 0,
    fuelSurcharge: q.fscCharge || 0,
    accessorials: q.accessorialCharge || 0,
    rateId: q.rateId || null,
    pickupTime: DEFAULT_PICKUP_TIME,
  };
}

async function planOrder(api, { order_id, carrier, mode, freight_class, allow_late = false }) {
  const r = await fetchOrderQuotes(api, { order_id, freight_class });
  const status = String(r.order.status || '').toLowerCase();
  if (status && status !== 'unplanned') {
    throw new ZoreeApiError(409, `Order ${order_id} is '${r.order.status}', not Unplanned`
      + (r.order.shipment_id ? ` (already on ${r.order.shipment_id})` : ''));
  }

  const matches = pickQuote(r.quotes, carrier, mode);
  if (!matches.length) {
    const available = r.quotes.map((q) => `${q.carrier} (${q.mode})`).join(', ') || 'none';
    throw new ZoreeApiError(404, `No ${mode ? `${mode} ` : ''}quote from '${carrier}' for this order. Available: ${available}`);
  }
  if (matches.length > 1) {
    throw new ZoreeApiError(409, `'${carrier}' matches several quotes: ${matches.map((q) => `${q.carrier} (${q.mode})`).join(', ')}. Be more specific or pass mode.`);
  }
  const q = matches[0];
  if (q.infeasible) throw new ZoreeApiError(422, `${q.carrier} is marked infeasible for this order`);
  const dates = datesFor(q, r.order);
  if (!dates.pickup) throw new ZoreeApiError(422, `${q.carrier} has no transit time, so pickup/delivery dates can't be set`);
  if (dates.meetsDueDate === false && !allow_late) {
    throw new ZoreeApiError(422, `${q.carrier} delivers ${dates.delivery}, after the due date ${r.order.due}. Pass allow_late to plan anyway.`);
  }

  const plan = buildPlan(r.lane, q, dates);
  const res = await api.post('/api/bulk-plan/execute', { plans: [plan] });
  const errors = (res && res.errors) || [];
  const shipments = (res && res.shipments) || [];
  if (errors.length || !shipments.length) {
    throw new ZoreeApiError(500, `Planning failed: ${(errors[0] && errors[0].error) || 'no shipment created'}`);
  }

  const ship = shipments[0];
  return {
    planned: true,
    shipment: compact({
      id: ship.id,
      status: ship.status,
      carrier: ship.carrier,
      mode: ship.mode,
      total_cost: ship.total_cost,
      pickup_date: ship.pickup_date || plan.pickupDate,
      delivery_date: ship.delivery_date || plan.deliveryDate,
      order_ids: ship.order_ids,
    }),
    orders_updated: res.ordersUpdated,
    chosen_option: shapeQuote(q, r.order),
    dock: `Not reserved — use get_dock_availability / reserve_dock with ${ship.id} to book a door (pickup time set to 06:00).`,
  };
}

function registerPlanningTools(server, api) {
  server.registerTool('rate_order', {
    title: 'Rate order (all carrier options)',
    description: 'Every carrier option for one order, as shown in the ZoreeTMS Plan screen: LTL and TL carriers with '
      + 'total, base, fuel, miles, transit days, and the pickup/delivery dates the planner would use, plus whether '
      + 'each option meets the due date. Read-only — does not plan, tender or create a shipment.',
    inputSchema: {
      order_id: z.string().min(1).describe('Order id, e.g. ORD-457723'),
      freight_class: z.number().min(50).max(500).optional()
        .describe('Override NMFC class (default: highest class on the order lines, else 70)'),
      optimize_by: z.enum(['cost', 'transit']).optional().describe('Sort by cheapest (default) or fastest'),
    },
    annotations: { title: 'Rate order', ...READ_ONLY, idempotentHint: false, openWorldHint: true },
  }, safeHandler((args) => rateOrder(api, args)));

  server.registerTool('plan_order', {
    title: 'Plan order (create shipment)',
    description: 'Plan one Unplanned order with a chosen carrier: re-rates it like the Plan screen, takes that carrier\'s '
      + 'quote and creates the shipment (same server route and audit history as "Confirm & Create Shipment"). '
      + 'Show the user the carrier, cost and dates from rate_order and get their go-ahead before calling. '
      + 'Refuses if the order is not Unplanned, the carrier has no quote or transit time, or delivery would miss '
      + 'the due date (unless allow_late). Does not reserve a dock door — use reserve_dock on the new shipment.',
    inputSchema: {
      order_id: z.string().min(1).describe('Order id to plan'),
      carrier: z.string().min(2).describe('Carrier name (partial OK) or SCAC, e.g. "KLLM" or "XPOL"'),
      mode: z.enum(['TL', 'LTL']).optional().describe('Restrict to this mode when a carrier offers both'),
      freight_class: z.number().min(50).max(500).optional().describe('Same override as rate_order'),
      allow_late: z.boolean().optional().describe('Plan even if delivery lands after the due date'),
    },
    annotations: {
      title: 'Plan order', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true,
    },
  }, safeHandler((args) => planOrder(api, args)));
}

module.exports = {
  registerPlanningTools, rateOrder, planOrder, pickQuote, buildPlan, freightClassFromLines,
};
