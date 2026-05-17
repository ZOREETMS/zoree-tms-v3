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

import { ShipmentsApi, OrdersApi, BulkPlanApi, InvoicesApi } from "../lib/api";
// QA P213 (2026-05-11): use the existing copyShipment service so the
// AI's COPY_SHIPMENT action ends up producing the same row shape as
// the manual Duplicate button on ShipmentsPage — line items snapshot,
// projected transit window, audited insert path, the works.
import { copyShipment as copyShipmentService } from "./shipmentService";
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
import {
  buildLaneKey,
  // QA P214 (2026-05-11): use the same address composer the manual
  // planner runs in BulkPlanPage / OrdersPage so the AI's success
  // message renders the canonical "CITY, ST ZIP" form instead of a
  // raw warehouse name like "Atlanta XDock". Matches the data path
  // the manual flow takes via lane composition, so chat output and
  // the Shipments page agree on what the lane "looks like".
  fullOrderOrigin,
  fullOrderDest,
} from "../utils/laneUtils";

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

  // QA P216 (2026-05-11): weight-aware auto-split. The AI previously
  // bundled every supplied orderId into a single shipment, which broke
  // when the combined weight blew past a TL trailer cap (the QA repro
  // was 5 × 40,000 lb = 200,000 lbs in one shipment). The fix runs in
  // the AI caller — NOT the production bulkPlanExecution service — so
  // production paths are untouched and the manual planner's behavior
  // is unchanged. Cap is a conservative single-trailer max (45,000 lb,
  // matching the standard 53' dry-van legal limit); the model can pass
  // `maxWeightLbs` to override. We only split when bundling actually
  // overflows the cap, so single-shipment plans below the limit run
  // exactly the same code path as before.
  const totalWeight = planOrders.reduce(
    (s, o) => s + (Number(o?.weight) || 0),
    0,
  );
  const cap = Number(p.maxWeightLbs) > 0 ? Number(p.maxWeightLbs) : 45000;
  const autoSplit = p.autoSplit !== false;
  if (autoSplit && planOrders.length > 1 && totalWeight > cap) {
    // Greedy first-fit bin-packing. Orders are sorted descending by
    // weight so heavy ones go first, then we fit lighter orders into
    // any group that still has headroom. Anything heavier than the cap
    // becomes its own group (the planner will reject it downstream
    // with a clear error rather than producing an oversize shipment).
    const sorted = [...planOrders].sort(
      (a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0),
    );
    const bins = [];
    for (const o of sorted) {
      const w = Number(o.weight) || 0;
      let placed = false;
      for (const bin of bins) {
        if (bin.weight + w <= cap) {
          bin.orders.push(o);
          bin.weight += w;
          placed = true;
          break;
        }
      }
      if (!placed) bins.push({ orders: [o], weight: w });
    }

    const summaries = [];
    const failures = [];
    for (const bin of bins) {
      try {
        const r = await planOrdersAsSingleShipment(bin.orders, { carrier: p.carrier });
        if (!r.ok) {
          failures.push(
            `${bin.orders.map((x) => x.id).join(", ")}: ${r.errorMessage || "failed"}`,
          );
          continue;
        }
        const s = r.shipment;
        summaries.push(
          `**${s.id}** (${bin.orders.length} order${bin.orders.length === 1 ? "" : "s"}, ${bin.weight.toLocaleString()} lbs, ${s.carrier}, $${(s.total_cost || 0).toLocaleString()})`,
        );
      } catch (err) {
        failures.push(
          `${bin.orders.map((x) => x.id).join(", ")}: ${err?.message || err}`,
        );
      }
    }
    const lines = [
      `Bundled weight ${totalWeight.toLocaleString()} lbs > ${cap.toLocaleString()} lb cap — auto-split into ${bins.length} shipment${bins.length === 1 ? "" : "s"}:`,
      ...summaries.map((s) => `• ${s}`),
    ];
    if (failures.length) {
      lines.push("", `Failed bins (${failures.length}):`);
      failures.forEach((f) => lines.push(`• ${f}`));
    }
    return lines.join("\n");
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
  //
  // QA P214 (2026-05-11): re-derive origin / dest through the canonical
  // composer so the chat string matches what the manual planner sees
  // even when ship.origin / ship.dest came back as a bare warehouse
  // name (data-inconsistency case — see triage doc). We prefer the
  // composed value, fall back to ship.origin, then to "—". The
  // warehouse name (`ship_from_name` / `ship_to_name`) is appended only
  // when it adds info beyond the canonical address.
  const sourceOrder = planOrders[0] || {};
  const canonOrigin =
    fullOrderOrigin(sourceOrder) ||
    String(ship.origin || "").trim();
  const canonDest =
    fullOrderDest(sourceOrder) ||
    String(ship.dest || "").trim();
  function combine(canonical, name) {
    const a = (canonical || "").trim();
    const b = (name || "").trim();
    if (a && b && a.toLowerCase() !== b.toLowerCase()) return `${b} (${a})`;
    return a || b || "—";
  }
  const originLabel = combine(canonOrigin, ship.ship_from_name);
  const destLabel = combine(canonDest, ship.ship_to_name);
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

/* ── Action: COPY_SHIPMENT (QA P213, 2026-05-11) ──────────────────
 * Duplicate an existing shipment row with a fresh id + cleared
 * order/BOL/timeline fields, identical to what the manual Duplicate
 * button on ShipmentsPage does. Routes through `copyShipment` in
 * shipmentService.js so the audit + line-items snapshot + BOL stamp
 * stays in one place. The new shipment carries no linked orders —
 * orders can only live on one shipment at a time and the user
 * typically wants the lane/carrier/cost copied, not the linkage.
 */
async function copyShipmentAction(p, { shipments }) {
  const source = findShipment(shipments, p.shipmentId);
  const copy = await copyShipmentService(source);
  const newId = copy?.id || "(new)";
  return `Shipment ${source.id} copied → **${newId}** (status: Planned, no orders attached)`;
}

/* ── Action: UPDATE_ORDER (QA P212, 2026-05-11) ───────────────────
 * Lets the assistant patch order metadata that isn't status — PO
 * number, ready / due dates, customer, notes, AND the freight
 * details the planner cares about: piece count, weight, commodity,
 * ship-mode / service-level, preferred/excluded carrier, ref num,
 * ship-from/-to names, origin/dest zips. Routes through the audited
 * PATCH /api/orders/:id (OrdersApi.update) so REQ-02 change-history
 * rows are produced just like a UI edit, and the order/shipment
 * cascades inside orderService.updateOrder still run.
 *
 * Bug #340 (2026-05-16): the previous whitelist was metadata-only,
 * so when the user said "update ORD-509509 to 100 pieces" the model
 * fell through to UPDATE_ORDER_STATUS, hit its "only status changes
 * here" guard, and refused the edit — even though every field below
 * is editable in OrdersPage.openEdit. The backend mapper
 * (services/orders.js#orderToDb) already accepts these keys; we were
 * just blocking them client-side. Widening the whitelist closes that
 * gap. Status changes still route through UPDATE_ORDER_STATUS so the
 * cancel/unplan/cascade rules apply — `status` is intentionally NOT
 * in the list below.
 *
 * Accepts:
 *   { orderId,
 *     poNumber?, readyDate?, dueDate?, pickupDate?, deliveryDate?,
 *     customer?, notes?,
 *     pieces?, weight?, commodity?,
 *     shipMode?, serviceLevel?,
 *     preferredCarrier?, excludedCarrier?,
 *     refNum?,
 *     shipFromName?, shipToName?,
 *     originZip?, destZip? }
 *
 * Numeric coercion notes:
 *   - `pieces` must end up as a non-negative integer. We accept
 *     "100", "1,000", and 100; we reject negatives outright so the
 *     model can't silently zero out a column with bad input.
 *   - `weight` is parsed the same way (allows decimal lbs), with the
 *     same negative-rejection rule.
 *
 * Dates immutability: this action does NOT special-case ready / due
 * dates — if the user explicitly says "change the ready date to X",
 * they intend the change. The memory-noted rule ("dates immutable
 * after tender accept") covers PROGRAMMATIC stomping during
 * tender-accept cascades, not user-driven edits.
 */
const UPDATE_ORDER_FIELD_KEYS = Object.freeze([
  "poNumber",
  "readyDate",
  "dueDate",
  "pickupDate",
  "deliveryDate",
  "customer",
  "notes",
  // Freight details — the gap that was closing this action off for
  // the most common chat edit ("update pieces / weight").
  "pieces",
  "weight",
  "commodity",
  "shipMode",
  "serviceLevel",
  "preferredCarrier",
  "excludedCarrier",
  "refNum",
  "shipFromName",
  "shipToName",
  "originZip",
  "destZip",
]);

// Map UPDATE_ORDER param keys back to the snake_case columns / camel
// aliases the order row carries when the page builds it. Used only
// for rendering the before-value in the success diff — the actual
// PATCH body uses the camelCase keys above and lets
// services/orders.js#orderToDb pick the right column.
const UPDATE_ORDER_PREV_KEY = Object.freeze({
  poNumber:         "po_number",
  readyDate:        "ready_date",
  dueDate:          "due_date",
  pickupDate:       "pickup_date",
  deliveryDate:     "delivery_date",
  shipMode:         "ship_mode",
  serviceLevel:     "service_level",
  preferredCarrier: "preferred_carrier",
  excludedCarrier:  "excluded_carrier",
  refNum:           "ref_num",
  shipFromName:     "ship_from_name",
  shipToName:       "ship_to_name",
  originZip:        "origin_zip",
  destZip:          "dest_zip",
});

function coerceNonNegativeNumber(raw, fieldLabel, { integer }) {
  // Tolerate "1,000" style input — common when a user pastes from
  // the page header. Strip commas and whitespace before parsing.
  const cleaned = String(raw).replace(/,/g, "").trim();
  const n = integer ? parseInt(cleaned, 10) : Number(cleaned);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid ${fieldLabel}: "${raw}". Must be a non-negative number.`);
  }
  return n;
}

async function updateOrderAction(p, { orders }) {
  const ord = findOrder(orders, p.orderId);

  const patch = {};
  for (const k of UPDATE_ORDER_FIELD_KEYS) {
    const v = p[k];
    if (v === undefined || v === null || v === "") continue;
    if (k === "pieces") {
      patch[k] = coerceNonNegativeNumber(v, "pieces", { integer: true });
    } else if (k === "weight") {
      patch[k] = coerceNonNegativeNumber(v, "weight", { integer: false });
    } else {
      patch[k] = v;
    }
  }
  if (Object.keys(patch).length === 0) {
    throw new Error(
      "No editable fields supplied. Pass at least one of: " + UPDATE_ORDER_FIELD_KEYS.join(", "),
    );
  }
  // Snapshot before/after so the success message tells the user what
  // actually changed, not just "Order X updated".
  const before = Object.keys(patch).map((k) => {
    const prevKey = UPDATE_ORDER_PREV_KEY[k] || k;
    return [k, ord[prevKey] ?? ord[k] ?? "—"];
  });
  await OrdersApi.update(p.orderId, patch);
  const diff = Object.keys(patch)
    .map((k) => {
      const prev = before.find(([key]) => key === k)?.[1] ?? "—";
      return `${k}: ${prev} → ${patch[k]}`;
    })
    .join(", ");
  return `Order ${p.orderId} updated · ${diff}`;
}

/* ── Action: CREATE_INVOICE_FROM_SHIPMENT (QA P215, 2026-05-11) ────
 * Now wired end-to-end. The backend route
 *   POST /api/invoices/from-shipment   body: { shipmentId }
 * delegates to api/services/invoiceFromShipment, which is idempotent
 * (a second call against a shipment with an open invoice returns the
 * existing row with `reused: true`).
 *
 * Status gate mirrors what the manual UI button enforces — invoicing
 * a shipment that hasn't been tendered yet is almost never what the
 * user wants and surfaces a clearer error than letting the service
 * reject it later. "Cancelled" / "Planned" are blocked here.
 */
async function createInvoiceFromShipmentAction(p, { shipments }) {
  const ship = findShipment(shipments, p.shipmentId);
  const blocked = new Set(["Planned", "Cancelled"]);
  if (blocked.has(ship.status)) {
    throw new Error(
      `Shipment ${p.shipmentId} is ${ship.status} — invoicing requires the shipment to be Tendered, Tender Accepted, In Transit, or Delivered.`,
    );
  }
  const result = await InvoicesApi.createFromShipment(p.shipmentId);
  const inv = result?.invoice || result;
  const invoiceId = inv?.id || inv?.invoice_id || "(new)";
  const total = inv?.invoiced_amount ?? inv?.agreed_cost ?? inv?.total_cost ?? null;
  const totalStr = total != null
    ? ` · $${Number(total).toLocaleString()}`
    : "";
  const reused = result?.reused
    ? " (existing open invoice — reused, no duplicate created)"
    : "";
  return `Invoice **${invoiceId}** created from shipment ${p.shipmentId}${totalStr}${reused}`;
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

  // Bug #192: chat-supplied carrier-response fields. The user
  // typically types "accept tender for SHP-123 with PRO ABC456",
  // and the model emits { shipmentId, proNumber } in the action
  // params. The previous version read pro_number / bol_number /
  // seal_number / pickup_date / service_level / dock_door from
  // ship.* only, so the chat-supplied values were silently
  // dropped — same shipment, same OMS row, no PRO. Pull from the
  // params first and fall back to whatever is already on the
  // shipment row so an "accept with no extras" call still works.
  //
  // String-trim before testing falsiness so a stray space the
  // model may add doesn't get persisted as an empty PRO.
  const trim = (v) => (v == null ? "" : String(v).trim());
  const proNumber    = trim(p.proNumber)    || trim(ship.pro_number);
  const bolNumber    = trim(p.bolNumber)    || trim(ship.bol_number);
  const sealNumber   = trim(p.sealNumber)   || trim(ship.seal_number);
  const pickupDate   = trim(p.pickupDate)   || trim(ship.pickup_date);
  const serviceLevel = trim(p.serviceLevel) || trim(ship.service_level);
  const dockDoor     = trim(p.dockDoor)     || trim(ship.dock_door);

  // 1. Move shipment status to "Tender Accepted" — the canonical post-
  //    accept value (migration 036). Cascades to linked CBOLs when
  //    this is a master shipment, mirroring ShipmentsPage.
  // Bug #38 follow-up: audited PATCH route. Status transition writes a
  // change_history row that the Shipment Timeline picks up, and the
  // linked-order cascade fires inside shipService.updateShipment.
  //
  // Bug #192: persist any chat-supplied carrier-response fields onto
  // the shipment row in the SAME audited update so the History tab
  // shows the new PRO / BOL / seal alongside the status change. Fields
  // that weren't supplied (and weren't already on the row) are sent as
  // null so the UI mapper drops them — never overwrites a real value
  // with a blank.
  const shipmentPatch = { status: "Tender Accepted" };
  if (proNumber    && proNumber    !== ship.pro_number)     shipmentPatch.proNumber    = proNumber;
  if (bolNumber    && bolNumber    !== ship.bol_number)     shipmentPatch.bolNumber    = bolNumber;
  if (sealNumber   && sealNumber   !== ship.seal_number)    shipmentPatch.sealNumber   = sealNumber;
  if (pickupDate   && pickupDate   !== ship.pickup_date)    shipmentPatch.pickupDate   = pickupDate;
  if (serviceLevel && serviceLevel !== ship.service_level)  shipmentPatch.serviceLevel = serviceLevel;
  if (dockDoor     && dockDoor     !== ship.dock_door)      shipmentPatch.dockDoor     = dockDoor;
  await ShipmentsApi.update(ship.id, shipmentPatch);
  const isMbol = ship.bol_type === "MBOL";
  const children = isMbol
    ? shipments.filter((s) => s.master_shipment_id === ship.id && s.bol_type === "CBOL")
    : [];
  if (isMbol && children.length) {
    // CBOLs only get the status flip — PRO/BOL/seal are master-level
    // identifiers in this codebase, so we don't propagate them down.
    await Promise.all(
      children.map((c) => ShipmentsApi.update(c.id, { status: "Tender Accepted" }))
    );
  }

  // 2. Move linked orders to "Tender Accepted".
  const linkedOrders = await confirmOrdersForShipment(ship, shipments, orders);

  // 3. OMS mirror + WS broadcast (REQ-24 / REQ-13 parity with the UI).
  //    Carrier-supplied fields prefer the chat-supplied values, falling
  //    back to whatever is already on the shipment row. Bug #192: the
  //    previous version ignored p.proNumber here, so an OMS-side
  //    consumer never saw the PRO the user typed in chat.
  let propagation = null;
  try {
    propagation = await propagateTenderAcceptance({
      shipment: ship,
      response: {
        proNumber,
        carrierPickupDate: pickupDate,
        serviceLevel,
        bolNumber,
        sealNumber,
        dockDoor,
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
  // Surface the PRO so the user can see the value they typed actually
  // landed on the shipment — a quick visual confirmation that fixes the
  // silent-drop bug from before.
  const proNote = proNumber ? ` · PRO ${proNumber}` : "";
  return `Shipment ${ship.id} tender accepted${proNote} · ${linkedOrders.length} order(s) updated · ${omsNote}${mbolNote}`;
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
    // QA P212 (2026-05-11) — order metadata edits (PO, dates, etc.).
    case "UPDATE_ORDER":          return updateOrderAction(params, safeCtx);
    // QA P213 (2026-05-11) — duplicate a shipment with a fresh id.
    case "COPY_SHIPMENT":
    case "DUPLICATE_SHIPMENT":    return copyShipmentAction(params, safeCtx);
    // QA P215 (2026-05-11) — create freight invoice from a shipment.
    case "CREATE_INVOICE":
    case "CREATE_INVOICE_FROM_SHIPMENT":
                                  return createInvoiceFromShipmentAction(params, safeCtx);
    default: throw new Error(`Unknown action: ${action}`);
  }
}
