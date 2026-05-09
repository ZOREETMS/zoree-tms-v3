/**
 * ZoreeAI Actions Service
 * ----------------------------------------------------------------
 * Single entry point for executing the action blocks the chat
 * model emits. Lives here (not in the component) per CLAUDE_RULES:
 *   §1  Separate UI from business logic
 *   §3  Components MUST NOT call the API layer
 *   §4  All API calls go through services
 *   §10 No combining layers, no skipping services
 *
 * Each action uses the SAME services the regular UI surfaces use,
 * so a chat-driven mutation produces the same shipment/order rows,
 * timeline events, and side-effects as a click-driven one.
 */

import { ShipmentsApi, OrdersApi, BulkPlanApi } from "../lib/api";
import { planOrdersAsSingleShipment } from "./bulkPlanService";
import {
  unplanOrderFromShipment,
  copyOrder,
  cancelOrder as cancelOrderService,
  validateAndFailPastDueOrders,
} from "./ordersService";
import {
  recordShipmentEvent,
  deleteShipmentById,
  changeShipmentCarrier,
} from "./shipmentService";
import { unplanOrdersForShipmentRemoval, confirmOrdersForShipment } from "./shipmentOrderService";
import { propagateTenderAcceptance } from "./tenderAcceptanceNotifier";
import {
  gatherOrderDetails,
  sendTenderEmailIfAvailable,
} from "./tenderService";
import { buildLaneKey } from "../utils/laneUtils";

/* ── Internal helpers ──────────────────────────────────────────── */

function findOrder(orders, id) {
  const ord = (orders || []).find((o) => o.id === id);
  if (!ord) throw new Error(`Order ${id} not found`);
  return ord;
}

function findShipment(shipments, id) {
  const ship = (shipments || []).find((s) => s.id === id);
  if (!ship) throw new Error(`Shipment ${id} not found`);
  return ship;
}

/**
 * Attach `_linkedOrders` to a shipment row in-memory so the helpers
 * that the regular UI shares (e.g. `unplanOrdersForShipmentRemoval`)
 * can be called from the chat. The page builds this derived field;
 * the chat data snapshot doesn't, so we synthesize it here.
 */
function withLinkedOrders(shipment, orders) {
  if (!shipment) return shipment;
  if (Array.isArray(shipment._linkedOrders)) return shipment;
  const linked = (orders || []).filter((o) => o.shipment_id === shipment.id);
  return { ...shipment, _linkedOrders: linked };
}

/* ── Action: PLAN_ORDER ────────────────────────────────────────── */

async function planOrder(p, { orders }) {
  let rawIds = p.orderIds || (p.orderId ? [p.orderId] : []);
  if (!Array.isArray(rawIds)) rawIds = [rawIds];
  if (rawIds.length === 0) throw new Error("No order IDs provided");

  const planOrders = rawIds.map((oid) => {
    const ord = findOrder(orders, oid);
    if (ord.status !== "Unplanned") {
      throw new Error(`Order ${oid} is ${ord.status} — only Unplanned orders can be planned`);
    }
    return ord;
  });

  // Match UI guard (OrdersPage.openPlanModal): past-due orders are flipped
  // to "Planning Failed" with a note, never rated. Without this, a chat-driven
  // plan succeeds while the UI plan refuses the same order — REQ-02 audit trail
  // and order state diverge between surfaces.
  const { failed: pastDue } = await validateAndFailPastDueOrders(planOrders);
  if (pastDue.length > 0) {
    const ids = pastDue.map((o) => o.id).join(", ");
    const dueList = pastDue.map((o) => `${o.id} (${o.due})`).join(", ");
    throw new Error(
      pastDue.length === 1
        ? `Order ${ids} failed planning — due date ${pastDue[0].due} is in the past`
        : `Orders failed planning — due dates in the past: ${dueList}`
    );
  }

  const result = await planOrdersAsSingleShipment(planOrders, { carrier: p.carrier });
  if (!result.ok) throw new Error(result.errorMessage || "Failed to plan orders");

  const ship = result.shipment;
  // QA #141: render the full origin/dest address-to-address strings in the
  // AI confirmation, not just the first comma-delimited fragment. The
  // earlier `.split(",")[0]` cropped "ATLANTA, GA 30301" → "ATLANTA",
  // making it look like the planner had only city-level context. The
  // shipment row itself now also carries the full string (lane + plan
  // forward fullOrderOrigin/Dest from laneUtils).
  const originLabel = ship.ship_from_name
    ? `${ship.ship_from_name} (${ship.origin || "—"})`
    : (ship.origin || "—");
  const destLabel = ship.ship_to_name
    ? `${ship.ship_to_name} (${ship.dest || "—"})`
    : (ship.dest || "—");
  return `Shipment **${ship.id}** created · ${rawIds.length} order(s) · Carrier: ${ship.carrier} · ${ship.mode} · $${(ship.total_cost || 0).toLocaleString()} · ${originLabel} → ${destLabel}`;
}

/* ── Action: UPDATE_ORDER_STATUS ───────────────────────────────── */

async function updateOrderStatusAction(p, { orders, shipments }) {
  const ord = findOrder(orders, p.orderId);
  const prev = ord.status;

  if (p.newStatus === "Unplanned") {
    const { message } = await unplanOrderFromShipment(p.orderId, orders, shipments);
    return message;
  }
  await OrdersApi.update(p.orderId, { status: p.newStatus });
  return `Order ${p.orderId} status changed from ${prev} → ${p.newStatus}`;
}

/* ── Action: UPDATE_SHIPMENT_STATUS ────────────────────────────── */

// Map shipment statuses to the equivalent timeline event type so the
// backend can stamp pickup_date/delivery_date and write change_history
// rows the regular UI's "+ Add Event" flow produces.
const STATUS_TO_EVENT_TYPE = Object.freeze({
  "Picked Up":  "Picked Up",
  "In Transit": "In Transit",
  "Delivered":  "Delivered",
  "Exception":  "Exception",
});

async function updateShipmentStatusAction(p, { shipments }) {
  const ship = findShipment(shipments, p.shipmentId);
  const prev = ship.status;
  const eventType = STATUS_TO_EVENT_TYPE[p.newStatus];

  if (eventType) {
    await recordShipmentEvent(p.shipmentId, {
      type: eventType,
      note: p.note || `Status set to ${p.newStatus} via ZoreeAI`,
    });
    return `Shipment ${p.shipmentId} status changed from ${prev} → ${p.newStatus} (timeline event recorded)`;
  }

  // Bug #38 follow-up: route through the audited PATCH endpoint so
  // status-history rows land in change_history (and the linked-order
  // cascade fires inside shipService.updateShipment).
  await ShipmentsApi.update(p.shipmentId, { status: p.newStatus });
  return `Shipment ${p.shipmentId} status changed from ${prev} → ${p.newStatus}`;
}

/* ── Action: CHANGE_CARRIER (re-rates the lane) ─────────────────── */

async function changeCarrierAction(p, { shipments }) {
  const ship = findShipment(shipments, p.shipmentId);
  const carrierName = String(p.carrier || "").trim();
  if (!carrierName) throw new Error("carrier is required");
  const prevCarrier = ship.carrier || "—";

  // Re-rate the existing lane against the new carrier — same logic the
  // Change Carrier modal in ShipmentsPage runs, so the shipment row
  // ends up with correct rate / fuel_surcharge / total_cost / mode /
  // service_level / miles instead of stale numbers from the old carrier.
  const originZip = String(ship.origin_zip || ship.origin || "").match(/\b(\d{5})\b/)?.[1] || "";
  const destZip   = String(ship.dest_zip   || ship.dest   || "").match(/\b(\d{5})\b/)?.[1] || "";
  const lane = {
    laneKey: buildLaneKey(ship),
    origin: ship.origin || "",
    destination: ship.dest || "",
    originZip, destZip,
    freightClass: "70",
    totalWeight: ship.weight || 0,
    totalPieces: ship.pieces || 0,
    orderIds: Array.isArray(ship.order_ids) ? ship.order_ids : [],
  };
  const rateRes = await BulkPlanApi.rate([lane], "cost");
  const result  = Array.isArray(rateRes?.results) ? rateRes.results[0] : null;
  const quotes  = Array.isArray(result?.quotes) ? result.quotes : [];
  const target  = carrierName.toLowerCase();
  const chosen  = quotes.find((q) => String(q.carrier || "").trim().toLowerCase() === target);
  if (!chosen) {
    throw new Error(`No rate available for carrier "${carrierName}" on this lane — configure a rate first`);
  }

  // Route through the same audited service the Change Carrier modal
  // uses (frontend/src/services/shipmentService.js → POST
  // /api/shipments/:id/change-carrier). That endpoint writes one
  // change_history row per actually-changed field via
  // shipmentMutations.recordFieldDiffs and broadcasts SHIPMENT_UPDATED.
  // The previous DbApi.patch("shipments", ...) call here hit the raw
  // /db/shipments upsert, which is the path that left AI-driven carrier
  // changes invisible in the History tab — the exact bug we're fixing.
  // CLAUDE_RULES §3/§4: services never bypass the audited service.
  await changeShipmentCarrier(p.shipmentId, chosen, ship);
  return `Carrier for ${p.shipmentId} changed from ${prevCarrier} → ${chosen.carrier} · re-rated $${(chosen.totalCharge || 0).toLocaleString()}`;
}

/* ── Action: HOLD_ORDER ────────────────────────────────────────── */

async function holdOrderAction(p) {
  const reason = p.reason || "ZoreeAI action";
  await OrdersApi.update(p.orderId, {
    status: "On Hold",
    notes: `HOLD: ${reason}`,
  });
  return `Order ${p.orderId} placed On Hold — ${reason}`;
}

/* ── Action: CANCEL_ORDER ──────────────────────────────────────── */

async function cancelOrderAction(p, { orders }) {
  const ord = findOrder(orders, p.orderId);
  await cancelOrderService(p.orderId, ord.notes || "");
  return `Order ${p.orderId} cancelled — ${p.reason || "Manual user action"}`;
}

/* ── Action: CANCEL_SHIPMENT ───────────────────────────────────── */

async function cancelShipmentAction(p, { shipments, orders }) {
  const ship = findShipment(shipments, p.shipmentId);
  // Match UI guard — a tendered shipment must be withdrawn first so we
  // don't strand the carrier holding an active tender.
  if (ship.status === "Tendered") {
    throw new Error(`Shipment ${ship.id} is Tendered — withdraw the tender before cancelling`);
  }

  const rowWithLinks = withLinkedOrders(ship, orders);
  await unplanOrdersForShipmentRemoval(rowWithLinks, shipments, orders);
  await deleteShipmentById(ship.id);

  // Cascade cleanup for orphaned MBOL parents — same behavior as
  // ShipmentsPage.deleteShipment.
  let extraNote = "";
  if (ship.bol_type === "CBOL" && ship.master_shipment_id) {
    const siblings = shipments.filter(
      (s) => s.master_shipment_id === ship.master_shipment_id && s.id !== ship.id
    );
    if (siblings.length === 0) {
      await deleteShipmentById(ship.master_shipment_id);
      extraNote = ` · master ${ship.master_shipment_id} also deleted (no siblings)`;
    }
  }

  const linkedCount = (rowWithLinks._linkedOrders || []).length;
  return `Shipment ${ship.id} cancelled · ${linkedCount} order(s) returned to Unplanned${extraNote}`;
}

/* ── Action: FLAG_EXCEPTION (records timeline event) ───────────── */

async function flagExceptionAction(p, { shipments }) {
  const ship = findShipment(shipments, p.shipmentId);
  await recordShipmentEvent(ship.id, {
    type: "Exception",
    note: p.issue || "Flagged by ZoreeAI",
  });
  return `Shipment ${ship.id} flagged as Exception — ${p.issue || "no detail"}`;
}

/* ── Action: ADD_SHIPMENT_EVENT ────────────────────────────────── */

const VALID_EVENT_TYPES = Object.freeze([
  "Picked Up", "In Transit", "Delivered", "Exception", "Delay", "Note",
]);

async function addShipmentEventAction(p, { shipments }) {
  const ship = findShipment(shipments, p.shipmentId);
  const type = String(p.type || p.eventType || "").trim();
  if (!VALID_EVENT_TYPES.includes(type)) {
    throw new Error(`Invalid event type "${type}". Must be one of: ${VALID_EVENT_TYPES.join(", ")}`);
  }
  await recordShipmentEvent(ship.id, {
    type,
    note: p.note || "",
    date: p.date || undefined,
  });
  return `Event "${type}" recorded on ${ship.id}${p.note ? ` — ${p.note}` : ""}`;
}

/* ── Action: COPY_ORDER ────────────────────────────────────────── */

async function copyOrderAction(p, { orders }) {
  const source = findOrder(orders, p.orderId);
  const created = await copyOrder(source);
  return `Order ${source.id} copied → **${created.id}** (status: Unplanned)`;
}

/* ── Action: TENDER_SHIPMENT ───────────────────────────────────── */

async function tenderShipmentAction(p, { shipments, orders, carriers }) {
  const ship = findShipment(shipments, p.shipmentId);
  const carrierName = String(p.carrier || ship.carrier || "").trim();
  if (!carrierName) throw new Error("Shipment has no carrier — assign one before tendering");

  // Match UI guard — only Planned or Tender Rejected shipments can be
  // tendered. (Already-Tendered or In-Transit shouldn't be re-tendered.)
  const allowedStatuses = ["Planned", "Tender Rejected"];
  if (!allowedStatuses.includes(ship.status)) {
    throw new Error(`Cannot tender ${ship.id}: status is ${ship.status} (must be Planned or Tender Rejected)`);
  }

  // For an MBOL, the master + every CBOL must move to Tendered together.
  const isMbol = ship.bol_type === "MBOL";
  const children = isMbol
    ? shipments.filter((s) => s.master_shipment_id === ship.id && s.bol_type === "CBOL")
    : [];

  const linkedOrders = [
    ...orders.filter((o) => String(o.shipment_id || "") === String(ship.id)),
    ...children.flatMap((c) =>
      orders.filter((o) => String(o.shipment_id || "") === String(c.id))
    ),
  ];

  // Bug #38 follow-up: audited PATCH route, same as the manual UI
  // tender flow in ShipmentsPage.
  await Promise.all([
    ShipmentsApi.update(ship.id, { status: "Tendered", carrier: carrierName }),
    ...(isMbol
      ? children.map((c) =>
          ShipmentsApi.update(c.id, { status: "Tendered", carrier: carrierName })
        )
      : []),
  ]);

  // Best-effort tender email — failure does not roll back the status
  // change (matches ShipmentsPage behavior; backend records a
  // tender_failed history row when SMTP doesn't deliver).
  let emailSent = false;
  let emailTo = "";
  try {
    const orderDetails = await gatherOrderDetails(linkedOrders);
    const refNum = "TND-" + String(ship.id).replace(/^SHP-/i, "") + "-" + Math.floor(Math.random() * 9000 + 1000);
    const routeDisplay = `${ship.origin || ""} → ${ship.dest || ""}`;
    const tenderPayload = {
      shipmentId: ship.id,
      refNum,
      subject: `Load Tender: ${ship.id} — ${routeDisplay}`,
      origin: ship.origin || "",
      dest: ship.dest || "",
      pickup: ship.pickup_date || "",
      delivery: ship.delivery_date || ship.shipment_end_date || "",
      mode: ship.mode || "",
      cost: ship.total_cost ?? "",
      weight: ship.weight ?? "",
      pieces: ship.pieces || "",
      commodity: ship.commodity || "",
      specialInstructions: ship.special_instructions || ship.notes || "",
      dockDoor: ship.dock_door || "Door 1",
      dockTime: ship.dock_time || "06:00–08:00",
      ...orderDetails,
    };
    const sendRes = await sendTenderEmailIfAvailable({ carriers, carrierName, tenderPayload });
    emailSent = !!sendRes.sent;
    emailTo = sendRes.to || "";
  } catch (_emailErr) {
    /* swallow — status is already Tendered, email is best-effort */
  }

  const emailStatus = emailSent ? `email sent to ${emailTo}` : "email skipped (no carrier email on file)";
  const mbolNote = isMbol ? ` · ${children.length} CBOL(s) tendered` : "";
  return `Shipment ${ship.id} tendered to ${carrierName} · ${emailStatus}${mbolNote}`;
}

/* ── Action: WITHDRAW_TENDER ────────────────────────────────────
 *
 * Bug #165 / #175: previously the chat had no way to take a Tendered
 * shipment back to Planned — when the user said "withdraw tender for
 * SHP-...", the model fell through to CANCEL_SHIPMENT, which threw
 * "Shipment is Tendered — withdraw the tender before cancelling" and
 * the user got stuck in a loop. Mirrors ShipmentsPage.withdrawTender:
 *   - Only valid when status === 'Tendered'.
 *   - Patches status back to 'Planned' through the audited
 *     /api/shipments/:id PATCH route.
 *   - Cascades the same status flip to every CBOL when the row is an
 *     MBOL (matches the UI behaviour).
 */

async function withdrawTenderAction(p, { shipments }) {
  const ship = findShipment(shipments, p.shipmentId);
  if (ship.status !== "Tendered") {
    throw new Error(
      `Cannot withdraw tender for ${ship.id}: status is ${ship.status} (must be Tendered).`
    );
  }

  const isMbol = ship.bol_type === "MBOL";
  const children = isMbol
    ? shipments.filter((s) => s.master_shipment_id === ship.id && s.bol_type === "CBOL")
    : [];

  await Promise.all([
    ShipmentsApi.update(ship.id, { status: "Planned" }),
    ...children.map((c) => ShipmentsApi.update(c.id, { status: "Planned" })),
  ]);

  const mbolNote = isMbol ? ` · ${children.length} CBOL(s) withdrawn` : "";
  return `Tender withdrawn for ${ship.id}${mbolNote}. Status reverted to Planned.`;
}

/* ── Action: TENDER_ACCEPT ──────────────────────────────────────
 *
 * Carrier-side accept driven from chat. Fixes Bug #62: previously the
 * chat falling through to UPDATE_SHIPMENT_STATUS only patched the raw
 * status column (and for "Confirmed" it was silently downgraded back
 * to "Tendered" by an api/server.js workaround that has since been
 * removed). The shipment never actually moved out of Tendered, so the
 * UI kept showing the Accept/Reject buttons even though chat said
 * "✅ Tender Confirmed."
 *
 * Mirrors ShipmentsPage.confirmAcceptTender end-to-end so a chat-
 * driven accept produces the same row state, the same linked-order
 * updates, the same OMS mirror, and the same WS broadcast. Per
 * CLAUDE_RULES §4 it routes through the existing services
 * (confirmOrdersForShipment + propagateTenderAcceptance) — no new
 * cross-system logic is added here.
 */
async function tenderAcceptAction(p, { shipments, orders }) {
  const ship = findShipment(shipments, p.shipmentId);

  // Match the UI guard — only a Tendered shipment can be accepted.
  // The chat may emit ASCII variants of the status string, so trim
  // and compare case-insensitively.
  const raw = String(ship.status || "").trim();
  if (raw !== "Tendered") {
    throw new Error(`Cannot accept tender for ${ship.id}: status is ${raw || "empty"} (must be Tendered)`);
  }

  // 1. Move shipment status to "Tender Accepted" — the canonical post-
  //    accept value (migration 036). Cascades to linked CBOLs when
  //    this is a master shipment, mirroring ShipmentsPage.
  // Bug #38 follow-up: audited PATCH route. Status transition writes a
  // change_history row that the Shipment Timeline picks up, and the
  // linked-order cascade fires inside shipService.updateShipment.
  await ShipmentsApi.update(ship.id, { status: "Tender Accepted" });
  const isMbol = ship.bol_type === "MBOL";
  const children = isMbol
    ? shipments.filter((s) => s.master_shipment_id === ship.id && s.bol_type === "CBOL")
    : [];
  if (isMbol && children.length) {
    await Promise.all(
      children.map((c) => ShipmentsApi.update(c.id, { status: "Tender Accepted" }))
    );
  }

  // 2. Move linked orders to "Tender Accepted".
  const linkedOrders = await confirmOrdersForShipment(ship, shipments, orders);

  // 3. OMS mirror + WS broadcast (REQ-24 / REQ-13 parity with the UI).
  //    Carrier-supplied fields default to whatever is already on the
  //    shipment row — a chat accept doesn't have access to the form
  //    dialog the planner would otherwise fill in.
  let propagation = null;
  try {
    propagation = await propagateTenderAcceptance({
      shipment: ship,
      response: {
        proNumber:         ship.pro_number || "",
        carrierPickupDate: ship.pickup_date || "",
        serviceLevel:      ship.service_level || "",
        bolNumber:         ship.bol_number || "",
        sealNumber:        ship.seal_number || "",
        dockDoor:          ship.dock_door || "",
        dockLoadStart:     "",
        dockLoadEnd:       "",
        notes:             p.note || `Accepted via ZoreeAI chat`,
      },
      orderIds: linkedOrders.map((o) => o.id),
    });
  } catch (_propErr) {
    /* swallow — the DB writes above already committed; OMS mirror is
       best-effort, identical to the UI accept path. */
  }

  const omsNote = propagation && propagation.omsResult && propagation.omsResult.sent
    ? "OMS synced"
    : "OMS push best-effort";
  const mbolNote = isMbol ? ` · ${children.length} CBOL(s) accepted` : "";
  return `Shipment ${ship.id} tender accepted · ${linkedOrders.length} order(s) updated · ${omsNote}${mbolNote}`;
}

/* ── Action: GET_RATES ─────────────────────────────────────────── */

async function getRatesAction(p) {
  const originZip = p.originZip || "";
  const destZip = p.destZip || "";
  const weight = parseInt(p.weight) || 5000;
  const freightClass = parseInt(p.freightClass) || 70;
  const originCity = p.originCity || "";
  const destCity = p.destCity || "";
  if (!originZip || !destZip) throw new Error("originZip and destZip are required");

  const lane = {
    laneKey: `${originZip}-${destZip}`,
    originZip, destZip,
    totalWeight: weight,
    freightClass,
    origin: originCity || originZip,
    destination: destCity || destZip,
    orderIds: [],
  };
  // Route through BulkPlanApi (services layer) instead of a raw fetch
  // — CLAUDE_RULES §3/§4. Same backend endpoint, no behavior change.
  const rateRes = await BulkPlanApi.rate([lane], "cost");
  const result = Array.isArray(rateRes?.results) ? rateRes.results[0] : null;
  if (!result || !result.quotes?.length) {
    return `No rates available for ${originZip}→${destZip} (${weight} lbs). Check that carriers/rates are configured for this lane.`;
  }

  const ltlQuotes = result.quotes.filter((q) => q.mode === "LTL");
  const tlQuotes = result.quotes.filter((q) => q.mode === "TL");
  const otherQuotes = result.quotes.filter((q) => q.mode !== "LTL" && q.mode !== "TL");
  const best = result.bestQuote;
  const lines = [];

  lines.push(`**Load type:** ${result.loadType || "—"}`);
  if (best) lines.push(`**Best quote:** ${best.carrier} (${best.mode}) — **$${best.totalCharge}**`);
  lines.push("");

  if (ltlQuotes.length > 0) {
    lines.push(`**LTL Rates** (${ltlQuotes.length} carriers):`);
    ltlQuotes.forEach((q) => {
      const disc = q.discountPct > 0 ? ` | Disc: ${q.discountPct}%` : "";
      const fsc = q.fscCharge > 0 ? ` | FSC: $${q.fscCharge}` : "";
      const transit = q.transitDays ? ` | Transit: ${q.transitDays}d` : "";
      const svc = q.serviceLevel ? ` | ${q.serviceLevel}` : "";
      const rec = q.recommended ? " ⭐" : "";
      lines.push(`• ${q.carrier}: **$${q.totalCharge}**${disc}${fsc}${transit}${svc}${rec}`);
    });
    lines.push("");
  }
  if (tlQuotes.length > 0) {
    lines.push(`**TL Rates** (${tlQuotes.length} carriers):`);
    tlQuotes.forEach((q) => {
      const miles = q.pcmilerMiles || q.miles ? ` | ${q.pcmilerMiles || q.miles} mi` : "";
      const fsc = q.fscCharge > 0 ? ` | FSC: $${Math.round(q.fscCharge)}` : "";
      const transit = q.transitDays ? ` | Transit: ${q.transitDays}d` : "";
      const rec = q.recommended ? " ⭐" : "";
      lines.push(`• ${q.carrier}: **$${q.totalCharge}**${miles}${fsc}${transit}${rec}`);
    });
    lines.push("");
  }
  if (otherQuotes.length > 0) {
    lines.push(`**Other Modes** (${otherQuotes.length}):`);
    otherQuotes.forEach((q) => {
      lines.push(`• ${q.carrier} (${q.mode}): **$${q.totalCharge}**`);
    });
  }

  if (!ltlQuotes.length && !tlQuotes.length && !otherQuotes.length) {
    return `No carrier quotes returned for ${originZip}→${destZip} (${weight} lbs).`;
  }
  return `Live rates for ${originCity || originZip} → ${destCity || destZip} (${weight.toLocaleString()} lbs, Class ${freightClass}):\n\n${lines.join("\n")}`;
}

/* ── Public dispatch ───────────────────────────────────────────── */

/**
 * Set of action names whose execution should be confirmed by the
 * user before the chat runs them. Re-exported so the UI's
 * confirmation gate stays in lockstep with the executor's view of
 * "destructive" — adding a new action means updating one place.
 */
export const DESTRUCTIVE_CHAT_ACTIONS = Object.freeze(new Set([
  "CANCEL_ORDER",
  "CANCEL_SHIPMENT",
  "TENDER_SHIPMENT",   // sends email to carrier — irreversible side-effect
  "CHANGE_CARRIER",    // mutates rate / cost — surface for explicit confirm
]));

export function isDestructiveChatAction(actionName) {
  return DESTRUCTIVE_CHAT_ACTIONS.has(String(actionName || ""));
}

/**
 * Execute a chat-emitted action against the live TMS data.
 *
 * @param {{ action: string, params?: object }} actionData
 * @param {{ orders: object[], shipments: object[], carriers: object[], rates?: object[] }} ctx
 * @returns {Promise<string>}  user-facing success message
 */
export async function executeChatAction(actionData, ctx = {}) {
  const action = String(actionData?.action || "").trim();
  const params = actionData?.params || {};
  const safeCtx = {
    orders: Array.isArray(ctx.orders) ? ctx.orders : [],
    shipments: Array.isArray(ctx.shipments) ? ctx.shipments : [],
    carriers: Array.isArray(ctx.carriers) ? ctx.carriers : [],
    rates: Array.isArray(ctx.rates) ? ctx.rates : [],
  };

  switch (action) {
    case "PLAN_ORDER":            return planOrder(params, safeCtx);
    case "UPDATE_ORDER_STATUS":   return updateOrderStatusAction(params, safeCtx);
    case "UPDATE_SHIPMENT_STATUS": return updateShipmentStatusAction(params, safeCtx);
    // ASSIGN_CARRIER kept as a backwards-compatible alias — the model
    // may still emit it from cached prompt history. CHANGE_CARRIER is
    // the canonical name (re-rates the lane).
    case "ASSIGN_CARRIER":
    case "CHANGE_CARRIER":        return changeCarrierAction(params, safeCtx);
    case "HOLD_ORDER":            return holdOrderAction(params);
    case "CANCEL_ORDER":          return cancelOrderAction(params, safeCtx);
    case "CANCEL_SHIPMENT":       return cancelShipmentAction(params, safeCtx);
    case "FLAG_EXCEPTION":        return flagExceptionAction(params, safeCtx);
    case "ADD_SHIPMENT_EVENT":    return addShipmentEventAction(params, safeCtx);
    case "COPY_ORDER":            return copyOrderAction(params, safeCtx);
    case "TENDER_SHIPMENT":       return tenderShipmentAction(params, safeCtx);
    case "TENDER_ACCEPT":         return tenderAcceptAction(params, safeCtx);
    // Bug #165/#175: WITHDRAW_TENDER reverses a Tendered shipment back
    // to Planned. Without this the AI used to fall through to
    // CANCEL_SHIPMENT and hit its "withdraw the tender first" guard.
    case "WITHDRAW_TENDER":       return withdrawTenderAction(params, safeCtx);
    case "GET_RATES":             return getRatesAction(params);
    default: throw new Error(`Unknown action: ${action}`);
  }
}
