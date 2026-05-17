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
    "PLAN_ORDER            — params: { orderIds: [string], carrier?: string } — Creates a real shipment with full cost breakdown (rate, FSC, accessorials, service level, miles, equipment). USE THIS when user says 'plan order X'.",
    "UPDATE_ORDER_STATUS   — params: { orderId, newStatus }   — statuses: Unplanned, Planned, In Transit, Delivered, Cancelled, On Hold. Use ONLY for status transitions. For piece count, weight, dates, PO number, customer, etc. use UPDATE_ORDER instead.",
    "UPDATE_ORDER          — params: { orderId, pieces?, weight?, commodity?, poNumber?, readyDate?, dueDate?, pickupDate?, deliveryDate?, customer?, notes?, shipMode?, serviceLevel?, preferredCarrier?, excludedCarrier?, refNum?, shipFromName?, shipToName?, originZip?, destZip? } — Patches non-status fields on an existing order through the audited PATCH /api/orders/:id route (REQ-02 change-history rows are written, same as a UI edit). USE THIS whenever the user wants to change piece count (e.g. 'update ORD-509509 to 100 pieces', 'change pieces on ORD-… to 250'), weight ('set weight to 12000 lbs'), commodity, PO, ready/due/pickup/delivery dates, customer, notes, ship mode / service level, or preferred / excluded carrier on an order that already exists. Send at least one editable field. Status is NOT accepted here — use UPDATE_ORDER_STATUS for status. Do NOT tell the user 'you need to use the TMS UI' for these edits — they are fully chat-driven.",
    "UPDATE_SHIPMENT_STATUS — params: { shipmentId, newStatus } — statuses: Planned, Confirmed, In Transit, Delivered, Exception, Cancelled. For Picked Up / In Transit / Delivered / Exception this writes a timeline event and cascades to linked orders.",
    "CHANGE_CARRIER        — params: { shipmentId, carrier } — Swap a shipment's carrier AND re-rate the lane. Updates rate, fuel_surcharge, accessorials, total_cost, miles, service_level, mode, rate_id, equipment. Prefer over ASSIGN_CARRIER.",
    "ASSIGN_CARRIER        — params: { shipmentId, carrier } — DEPRECATED alias for CHANGE_CARRIER (kept for backward compatibility).",
    "TENDER_SHIPMENT       — params: { shipmentId, carrier? } — Tender a Planned (or Tender-Rejected) shipment to its carrier. Sets status=Tendered, propagates to CBOLs if MBOL, and sends the carrier tender email best-effort. Carrier defaults to the shipment's existing carrier when omitted.",
    "TENDER_ACCEPT         — params: { shipmentId, proNumber?, bolNumber?, sealNumber?, pickupDate?, serviceLevel?, dockDoor?, note? } — Accept a Tendered shipment on behalf of the carrier. Sets status='Tender Accepted', cascades to linked orders + CBOLs (MBOL), and runs the same OMS mirror + WS broadcast as the UI accept. CRITICAL: when the user types a PRO number anywhere in the message (e.g. 'accept tender for SHP-123 with PRO ABC456', 'PRO #12345', 'pro number 9876'), you MUST extract it and pass it as proNumber so it gets persisted on the shipment row and pushed to OMS. Same for bolNumber, sealNumber, pickupDate, serviceLevel, dockDoor when the user supplies them. USE THIS when the user says 'accept this tender' / 'confirm tender' / 'mark accepted'. Do NOT use UPDATE_SHIPMENT_STATUS for accepting — that path skips the OMS mirror and the linked-order cascade.",
    "WITHDRAW_TENDER       — params: { shipmentId } — Reverse a Tendered shipment back to 'Planned' (cascades to CBOLs if MBOL). USE THIS when the user says 'withdraw tender for SHP-…', 'pull back the tender', 'unter tender', or any pre-cancellation step on a Tendered shipment. Do NOT emit CANCEL_SHIPMENT for these phrasings — CANCEL_SHIPMENT refuses while the shipment is Tendered.",
    "ADD_SHIPMENT_EVENT    — params: { shipmentId, type, note?, date? } — Append a timeline event. type ∈ { 'Picked Up', 'In Transit', 'Delivered', 'Exception', 'Delay', 'Note' }. Backend cascades status to linked orders for Picked Up / Delivered / Exception.",
    "COPY_ORDER            — params: { orderId } — Duplicate an existing order (lines included) as a new Unplanned order. Use when the user says 'copy order X' or 'duplicate ORD-…'.",
    "HOLD_ORDER            — params: { orderId, reason }",
    "CANCEL_ORDER          — params: { orderId, reason }",
    "CANCEL_SHIPMENT       — params: { shipmentId, reason } — Unplans linked orders and removes the shipment row (cascades to MBOL/CBOL siblings). Cannot be used while status=Tendered.",
    "FLAG_EXCEPTION        — params: { shipmentId, issue } — Records an Exception timeline event (backend transitions shipment status).",
    "GET_RATES             — params: { originZip, destZip, weight, freightClass?, originCity?, destCity? } — fetch live rates for ALL modes (LTL via CzarLite + TL from rate table + PC*Miler mileage). Returns quotes from all available carriers. CRITICAL: ALWAYS include originCity and destCity derived from the zip: 770xx='Houston, TX', 752xx='Dallas, TX', 606xx='Chicago, IL', 303xx='Atlanta, GA', 100xx-104xx='New York, NY', 432xx='Columbus, OH', 981xx='Seattle, WA', 900xx='Los Angeles, CA', 331xx='Miami, FL'. Example: zip 77003 → originCity 'Houston, TX'. Without these, LTL discounts are NOT applied.",
    "",
    "Rules for actions:",
    '- "plan ORD-XXXX" = emit PLAN_ORDER action immediately. Keep text to 1-2 lines then the action block.',
    "- Safe actions (auto-executed): PLAN_ORDER, UPDATE_ORDER_STATUS, UPDATE_ORDER, UPDATE_SHIPMENT_STATUS, ASSIGN_CARRIER, HOLD_ORDER, FLAG_EXCEPTION, ADD_SHIPMENT_EVENT, COPY_ORDER, COPY_SHIPMENT, GET_RATES, TENDER_ACCEPT, WITHDRAW_TENDER, CREATE_INVOICE. Do NOT say 'click confirm' for these.",
    "- Destructive actions (require user confirmation): CANCEL_ORDER, CANCEL_SHIPMENT, TENDER_SHIPMENT (sends carrier email), CHANGE_CARRIER (mutates cost). The system shows a confirm prompt before executing.",
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
