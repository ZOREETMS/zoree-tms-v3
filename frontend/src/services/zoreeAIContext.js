/**
 * ZoreeAI Context Builder
 * ----------------------------------------------------------------
 * Pure functions that assemble the system prompt sent to Claude.
 *
 * Responsibilities:
 *   - Trim the TMS dataset to a size that fits comfortably under
 *     rate limits (was ~30k tokens, target ~6-8k).
 *   - Inject the scope-restriction directive from zoreeAIScope.
 *   - Provide deterministic output so prompt caching hits across
 *     turns (same data → same string → cache hit).
 *
 * No React, no fetch, no side effects — lives in services/.
 */

import { TMS_SCOPE_DIRECTIVE } from "./zoreeAIScope";

/**
 * Maximum counts included in the prompt. Increasing these raises
 * token cost per request and reduces ITPM headroom.
 */
const LIMITS = Object.freeze({
  ORDERS: 40,       // most-recent / most-relevant orders
  SHIPMENTS: 25,
  CARRIERS: 30,
  RATES: 15,
});

/**
 * Build the condensed carrier summary line.
 * Example: "AVERITT EXPRESS (SCAC:AVRT, OTD:97%, 14 shipments, $2.10/mi)"
 */
function summarizeCarriers(carriers, shipments) {
  return carriers
    .slice(0, LIMITS.CARRIERS)
    .map((c) => {
      const count = shipments.filter((s) => s.carrier === c.name).length;
      const cost = parseFloat(c.cost) || 0;
      const costSuffix = cost ? `, $${cost.toFixed(2)}/mi` : "";
      return `${c.name} (SCAC:${c.scac || "?"}, OTD:${c.otd || "?"}%, ${count} shipments${costSuffix})`;
    })
    .join("; ");
}

/**
 * Short per-shipment line, capped at LIMITS.SHIPMENTS.
 * Prioritizes in-transit and exception shipments.
 */
function summarizeShipments(shipments) {
  const priority = (s) => {
    if (s.status === "Exception") return 0;
    if (s.status === "In Transit") return 1;
    if (s.status === "Planned" || s.status === "Confirmed") return 2;
    return 3;
  };
  const sorted = [...shipments].sort((a, b) => priority(a) - priority(b));
  return sorted
    .slice(0, LIMITS.SHIPMENTS)
    .map((s) => {
      const origin = (s.origin || "").split(",")[0];
      const dest = (s.dest || s.destination || "").split(",")[0];
      return `${s.id}: ${origin}→${dest} | ${s.carrier || "?"} | ${s.status} | ${s.cost || "?"}`;
    })
    .join("\n");
}

/**
 * Short per-order line, capped at LIMITS.ORDERS.
 * Prioritizes Unplanned orders (most actionable) then recent status changes.
 */
function summarizeOrders(orders) {
  const priority = (o) => {
    if (o.status === "Unplanned") return 0;
    if (o.status === "On Hold") return 1;
    if (o.status === "Planned" || o.status === "Consolidated") return 2;
    return 3;
  };
  const sorted = [...orders].sort((a, b) => priority(a) - priority(b));
  return sorted
    .slice(0, LIMITS.ORDERS)
    .map((o) => {
      const origin = o.origin || "?";
      const dest = o.dest || o.destination || "?";
      const ready = o.ready || o.pickup_date || "?";
      const due = o.due || o.delivery_date || "?";
      const ship = o.shipment_id ? ` | Shipment: ${o.shipment_id}` : "";
      const pref = o.preferred_carrier ? ` [PREF:${o.preferred_carrier}]` : "";
      return `${o.id}: ${o.customer || "?"} | ${origin}→${dest} | ${o.weight || "?"}lbs | ${o.pieces || "?"} pcs | ${o.commodity || "—"} | Status: ${o.status} | Ready: ${ready} | Due: ${due}${ship}${pref}`;
    })
    .join("\n");
}

/**
 * Short per-rate line, capped at LIMITS.RATES.
 */
function summarizeRates(rates) {
  if (!rates || rates.length === 0) return "No rates configured";
  return rates
    .slice(0, LIMITS.RATES)
    .map((r) => {
      const origin = (r.origin || "").split(",")[0];
      const dest = (r.dest || r.destination || "").split(",")[0];
      return `${r.carrier || "?"}|${origin}→${dest} $${r.rate || "?"}/mi FSC:${r.fsc || "?"}`;
    })
    .join("; ");
}

/**
 * Build the action-catalogue section. Separated so it's easy to
 * audit the list of tools the model is told about.
 */
function buildActionSection() {
  return [
    "=== ACTIONS YOU CAN EXECUTE ===",
    "Respond with a JSON action block when the user wants to DO something.",
    "IMPORTANT: When executing an action, end your response with a JSON block in this exact format:",
    "```action",
    '{ "action": "ACTION_NAME", "params": { ... } }',
    "```",
    "",
    "Available actions:",
    "PLAN_ORDER            — params: { orderIds: [string], carrier?: string } — Creates a real shipment. USE THIS when user says 'plan order X'.",
    "UPDATE_ORDER_STATUS   — params: { orderId, newStatus }   — statuses: Unplanned, Planned, In Transit, Delivered, Cancelled, On Hold",
    "UPDATE_SHIPMENT_STATUS — params: { shipmentId, newStatus } — statuses: Planned, Confirmed, In Transit, Delivered, Exception, Cancelled",
    "ASSIGN_CARRIER        — params: { shipmentId, carrier }",
    "HOLD_ORDER            — params: { orderId, reason }",
    "CANCEL_ORDER          — params: { orderId, reason }",
    "CANCEL_SHIPMENT       — params: { shipmentId, reason }",
    "FLAG_EXCEPTION        — params: { shipmentId, issue }",
    "GET_RATES             — params: { originZip, destZip, weight, freightClass?, originCity?, destCity? } — fetch live rates for ALL modes (LTL via CzarLite + TL from rate table + PC*Miler mileage). Returns quotes from all available carriers. CRITICAL: ALWAYS include originCity and destCity derived from the zip: 770xx='Houston, TX', 752xx='Dallas, TX', 606xx='Chicago, IL', 303xx='Atlanta, GA', 100xx-104xx='New York, NY', 432xx='Columbus, OH', 981xx='Seattle, WA', 900xx='Los Angeles, CA', 331xx='Miami, FL'. Example: zip 77003 → originCity 'Houston, TX'. Without these, LTL discounts are NOT applied.",
    "",
    "Rules for actions:",
    '- "plan ORD-XXXX" = emit PLAN_ORDER action immediately. Keep text to 1-2 lines then the action block.',
    "- PLAN_ORDER, ASSIGN_CARRIER, UPDATE_ORDER_STATUS, UPDATE_SHIPMENT_STATUS, HOLD_ORDER, FLAG_EXCEPTION, and GET_RATES are safe actions — they will be auto-executed immediately. Do NOT say 'click confirm' or 'waiting for confirmation' for these actions.",
    "- CANCEL_ORDER and CANCEL_SHIPMENT are destructive — they will show a confirmation prompt to the user before executing.",
    "- After emitting a safe action block, do NOT say the action was already executed. The system will execute it automatically and show the result.",
    "- Never fabricate order or shipment IDs — only use IDs from the data above.",
  ].join("\n");
}

/**
 * Build a one-line detail row for an order (reuses summarizeOrders format).
 */
function formatOrderLine(o) {
  const origin = o.origin || "?";
  const dest = o.dest || o.destination || "?";
  const ready = o.ready || o.pickup_date || "?";
  const due = o.due || o.delivery_date || "?";
  const ship = o.shipment_id ? ` | Shipment: ${o.shipment_id}` : "";
  const pref = o.preferred_carrier ? ` [PREF:${o.preferred_carrier}]` : "";
  return `${o.id}: ${o.customer || "?"} | ${origin}→${dest} | ${o.weight || "?"}lbs | ${o.pieces || "?"} pcs | ${o.commodity || "—"} | Status: ${o.status} | Ready: ${ready} | Due: ${due}${ship}${pref}`;
}

/**
 * Build a one-line detail row for a shipment (reuses summarizeShipments format).
 */
function formatShipmentLine(s) {
  const origin = (s.origin || "").split(",")[0];
  const dest = (s.dest || s.destination || "").split(",")[0];
  return `${s.id}: ${origin}→${dest} | ${s.carrier || "?"} | ${s.status} | ${s.cost || "?"}`;
}

/**
 * Build a "referenced records" section listing any specific IDs the
 * user mentioned. These are injected regardless of the trimming
 * limits so the model can always act on exact IDs in the query.
 *
 * @param {Object} data - Full TMS dataset.
 * @param {string[]} referencedIds - IDs extracted from user message.
 * @returns {string|null} Section text, or null if nothing to show.
 */
function buildReferencedSection(data, referencedIds) {
  if (!referencedIds || referencedIds.length === 0) return null;

  const { orders = [], shipments = [] } = data || {};
  const orderMap = new Map(orders.map((o) => [String(o.id).toUpperCase(), o]));
  const shipMap = new Map(shipments.map((s) => [String(s.id).toUpperCase(), s]));

  const lines = [];
  const notFound = [];

  for (const rawId of referencedIds) {
    const id = String(rawId).toUpperCase();
    if (orderMap.has(id)) {
      lines.push(formatOrderLine(orderMap.get(id)));
    } else if (shipMap.has(id)) {
      lines.push(formatShipmentLine(shipMap.get(id)));
    } else {
      notFound.push(id);
    }
  }

  if (lines.length === 0 && notFound.length === 0) return null;

  const parts = ["=== REFERENCED RECORDS (exact matches from user query) ==="];
  if (lines.length > 0) parts.push(lines.join("\n"));
  if (notFound.length > 0) {
    parts.push(`NOT FOUND in TMS: ${notFound.join(", ")} — tell the user this ID does not exist.`);
  }
  return parts.join("\n");
}

/**
 * Build the complete system prompt.
 *
 * @param {Object} data
 * @param {Array} [data.orders]
 * @param {Array} [data.shipments]
 * @param {Array} [data.carriers]
 * @param {Array} [data.rates]
 * @param {Array} [data.lanePreferences]
 * @param {string[]} [referencedIds] - Order/shipment IDs mentioned in
 *   the current user message. Guaranteed to be included in the prompt
 *   even if they fall outside the trimming window.
 * @returns {string} The full system prompt text.
 */
export function buildSystemPrompt(data, referencedIds = []) {
  const {
    orders = [],
    shipments = [],
    carriers = [],
    rates = [],
  } = data || {};

  const unplanned = orders.filter((o) => o.status === "Unplanned").length;
  const planned = orders.filter((o) => o.status === "Planned" || o.status === "Consolidated").length;
  const inTransit = shipments.filter((s) => s.status === "In Transit").length;
  const exceptions = shipments.filter((s) => s.status === "Exception").length;

  const referencedSection = buildReferencedSection(data, referencedIds);

  const sections = [
    "You are ZoreeAI, an AI assistant embedded in ZoreeTMS — a Transportation Management System.",
    "You have live access to the TMS data below. Be concise, specific, and actionable. Reference actual IDs and numbers.",
    "",
    TMS_SCOPE_DIRECTIVE,
    "",
  ];

  if (referencedSection) {
    sections.push(referencedSection, "");
  }

  sections.push(
    `=== SHIPMENTS (total: ${shipments.length}, showing up to ${LIMITS.SHIPMENTS} prioritized) ===`,
    `In Transit: ${inTransit} | Exceptions: ${exceptions}`,
    summarizeShipments(shipments) || "None",
    "",
    `=== ORDERS (total: ${orders.length}, showing up to ${LIMITS.ORDERS} prioritized) ===`,
    `Unplanned: ${unplanned} | Planned/Consolidated: ${planned}`,
    summarizeOrders(orders) || "None",
    "",
    "=== CARRIERS ===",
    summarizeCarriers(carriers, shipments) || "None configured",
    "",
    "=== RATES ===",
    summarizeRates(rates),
    "",
    buildActionSection(),
    "",
    "IMPORTANT: When a user references a specific ID, first check the REFERENCED RECORDS section above — it is the source of truth for that ID. If not found there AND not in the lists below, the ID does not exist.",
  );

  return sections.join("\n");
}

/**
 * Exposed for tests / debugging. Do not import in UI code.
 */
export const __LIMITS = LIMITS;
