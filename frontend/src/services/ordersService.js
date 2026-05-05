/**
 * Business logic / API functions extracted from OrdersPage.
 * Pure service layer — no React state, no toasts, no UI side-effects.
 */

import { DbApi, OrdersApi, BulkPlanApi, MileageApi } from "../lib/api";
import { buildAddressString } from "../types/location";
// REQ-28: per-order planning failure reasons. Enum lives in types/; the
// collector module owns the "how we accumulate + attribute failures"
// plumbing so bulkPlanOrders doesn't have to hold it inline.
import { FAILURE_CODES } from "../types/planningFailure";
import {
  createFailureCollector,
  dropReasonForLane,
  mapBackendErrorsToOrders,
} from "./bulkPlanFailureCollector";
import { buildLaneKey } from "../utils/laneUtils";

// ── REQ-01: Auto order sync — SSE subscription ─────────────────────
// Browser opens an EventSource to /api/events/orders. Any order
// created/updated/deleted on the server is pushed to us live, so the
// Orders page updates without any button click or poll.
//
// Known trap: Cloudflare tunnels (and most reverse proxies that don't
// explicitly forward SSE) BUFFER the stream, so the EventSource opens
// but `order.created` events never arrive. If VITE_API_BASE points to
// a tunnel, we prefer the direct API URL for the SSE stream whenever
// the browser is running on localhost. A dedicated VITE_SSE_BASE env
// var takes precedence for deployments that need a different host.
const API_BASE =
  (import.meta && import.meta.env && import.meta.env.VITE_API_BASE) ||
  (typeof window !== "undefined" && window.ZOREE_API_URL) ||
  "http://localhost:3010/api";

function resolveSseBase() {
  const explicit = (import.meta && import.meta.env && import.meta.env.VITE_SSE_BASE)
    || (typeof window !== "undefined" && window.ZOREE_SSE_URL);
  if (explicit) return String(explicit).replace(/\/$/, "");
  // When the browser is on localhost (dev or port-forwarded), always
  // hit the API server directly — bypasses Cloudflare / nginx buffering.
  if (typeof window !== "undefined" && /^localhost|^127\.0\.0\.1/.test(window.location.hostname)) {
    return "http://localhost:3010/api";
  }
  return API_BASE;
}

/**
 * Subscribe to live order events from the TMS backend.
 * @param {object} handlers
 * @param {(payload: object) => void} [handlers.onCreated]
 * @param {(payload: object) => void} [handlers.onUpdated]
 * @param {(payload: object) => void} [handlers.onDeleted]
 * @param {(payload: { count: number, ids: string[], at: string }) => void} [handlers.onBatch]
 * @param {(err: Event) => void} [handlers.onError]
 * @returns {() => void} unsubscribe — call to close the stream.
 */
export function subscribeOrderChanges(handlers = {}) {
  if (typeof window === "undefined" || typeof window.EventSource !== "function") {
    // SSR / unsupported browser — noop unsubscribe.
    return () => {};
  }
  const url = `${resolveSseBase()}/events/orders`;
  const es = new EventSource(url, { withCredentials: false });

  if (handlers.onCreated) es.addEventListener("order.created", (e) => safeInvoke(handlers.onCreated, e));
  if (handlers.onUpdated) es.addEventListener("order.updated", (e) => safeInvoke(handlers.onUpdated, e));
  if (handlers.onDeleted) es.addEventListener("order.deleted", (e) => safeInvoke(handlers.onDeleted, e));
  if (handlers.onBatch)   es.addEventListener("oms.sync.batch", (e) => safeInvoke(handlers.onBatch, e));

  es.onerror = (err) => {
    if (handlers.onError) handlers.onError(err);
    // EventSource auto-reconnects on its own — no need to re-open manually.
  };

  return () => {
    try { es.close(); } catch (_) { /* already closed */ }
  };
}

function safeInvoke(cb, event) {
  try {
    const payload = event && event.data ? JSON.parse(event.data) : null;
    cb(payload);
  } catch (e) {
    // Malformed payload — swallow so one bad event doesn't tear down the stream.
    console.warn("[subscribeOrderChanges] invalid event payload:", e?.message || e);
  }
}
import { addBusinessDays } from "../utils/orderUtils.jsx";
import { assignDocksToPlans, buildDockFields } from "./dockService";
import { DOCK_DOORS, LOAD_DURATION_BY_MODE } from "../constants/docks";
import { getLoadDuration } from "./dockLoadingDurationsService";
import { getDockConfigForWarehouse } from "./dockScheduleService";
import { saveDocument } from "./documentService";

const QUOTE_CACHE_TTL_MS = 2 * 60 * 1000;
const quoteCache = new Map();

// REQ-09: when an order explicitly picks a mode (TL / LTL / Parcel / …),
// that mode acts as a constraint — the planner must only consider
// carrier quotes for the same mode. Empty / null / "Any" means no
// constraint and all quotes are eligible.
export function normalizeMode(m) {
  const s = String(m || "").trim().toUpperCase();
  if (!s || s === "ANY" || s === "ALL") return "";
  if (s === "FTL" || s === "TRUCKLOAD" || s === "FULL TRUCKLOAD") return "TL";
  if (s === "LESS THAN TRUCKLOAD" || s === "LTL FREIGHT") return "LTL";
  return s;
}

export function commonModeConstraint(orders) {
  const modes = new Set((orders || []).map((o) => normalizeMode(o?.ship_mode || o?.shipMode)).filter(Boolean));
  if (modes.size === 1) return [...modes][0];
  return "";
}

// REQ-10: normalize service-level labels so "standard" / "STD" / "Standard"
// all collapse to the same canonical bucket. "Any" means unconstrained.
export function normalizeServiceLevel(sl) {
  const s = String(sl || "").trim();
  if (!s) return "";
  const u = s.toUpperCase();
  if (u === "ANY" || u === "ALL") return "";
  if (u === "STD") return "Standard";
  if (u === "EXP") return "Expedited";
  if (u === "GTD") return "Guaranteed";
  // Title-case the rest so comparisons are stable.
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function commonServiceLevelConstraint(orders) {
  const lvls = new Set((orders || []).map((o) => normalizeServiceLevel(o?.service_level || o?.serviceLevel)).filter(Boolean));
  if (lvls.size === 1) return [...lvls][0];
  return "";
}

function quoteCacheKey(lane) {
  return JSON.stringify({
    laneKey: lane?.laneKey || "",
    origin: lane?.origin || "",
    destination: lane?.destination || "",
    originZip: lane?.originZip || "",
    destZip: lane?.destZip || "",
    freightClass: lane?.freightClass || "",
    totalWeight: Number(lane?.totalWeight || 0),
    totalPieces: Number(lane?.totalPieces || 0),
    orderCount: Array.isArray(lane?.orderIds) ? lane.orderIds.length : 0,
    // REQ-09: mode constraint participates in the cache key so TL and LTL
    // quote sets for the same lane don't collide.
    modeConstraint: normalizeMode(lane?.modeConstraint),
    // REQ-10: same for service level.
    serviceLevelConstraint: normalizeServiceLevel(lane?.serviceLevelConstraint),
  });
}

export function invalidateQuoteCache() {
  quoteCache.clear();
}

/**
 * Normalize an origin/destination string from city, state, zip parts.
 * Uppercases city and state to ensure consistent data storage.
 *
 * REQ-24 refactor: this is now a thin wrapper around the canonical
 * `buildAddressString` in types/location.js. Kept in place so existing
 * callers (OrdersPage.jsx) don't need to change. Prefer importing
 * `buildAddressString` directly from `src/types/location` in new code.
 *
 * @param {string} city
 * @param {string} state
 * @param {string} zip
 * @returns {string} e.g. "ATLANTA, GA 30350"
 */
export function buildLocationString(city, state, zip) {
  return buildAddressString({ city, state, zip });
}

/**
 * Cancel an order — sets status to Cancelled with a note.
 * @param {string} id - Order ID
 * @param {string} [existingNotes] - Existing notes to append to
 * @returns {Promise<object>}
 */
export async function cancelOrder(id, existingNotes) {
  const note = (existingNotes ? existingNotes + " | " : "") +
    "CANCELLED: Manual user action (" + new Date().toLocaleDateString() + ")";
  return OrdersApi.update(id, { status: "Cancelled", notes: note });
}

/**
 * Permanently delete an order from the database.
 * @param {string} id - Order ID
 * @returns {Promise<void>}
 */
export async function deleteOrderById(id) {
  return OrdersApi.remove(id);
}

/**
 * Save edited order fields to the database.
 * @param {string} id - Order ID
 * @param {object} patch - Fields to update
 * @returns {Promise<object>}
 */
export async function saveOrder(id, patch) {
  return OrdersApi.update(id, mapDbOrderToApiOrder(patch));
}

/**
 * Create a new order in the database.
 * @param {object} orderData - Full order object
 * @returns {Promise<object>}
 */
export async function createNewOrder(orderData) {
  return OrdersApi.create(mapDbOrderToApiOrder(orderData));
}

function mapDbOrderToApiOrder(payload = {}) {
  const mapped = { ...payload };

  if ("dest" in payload) {
    mapped.destination = payload.dest;
    delete mapped.dest;
  }
  if ("ready" in payload) {
    mapped.readyDate = payload.ready;
    delete mapped.ready;
  }
  if ("due" in payload) {
    mapped.dueDate = payload.due;
    delete mapped.due;
  }
  if ("shipment_id" in payload) {
    mapped.shipmentId = payload.shipment_id;
    delete mapped.shipment_id;
  }
  if ("ship_mode" in payload) {
    mapped.shipMode = payload.ship_mode;
    delete mapped.ship_mode;
  }
  if ("no_contract_rate" in payload) {
    mapped.noContractRate = payload.no_contract_rate;
    delete mapped.no_contract_rate;
  }
  if ("preferred_carrier" in payload) {
    mapped.preferredCarrier = payload.preferred_carrier;
    delete mapped.preferred_carrier;
  }
  if ("excluded_carrier" in payload) {
    mapped.excludedCarrier = payload.excluded_carrier;
    delete mapped.excluded_carrier;
  }
  if ("no_consolidate" in payload) {
    mapped.noConsolidate = payload.no_consolidate;
    delete mapped.no_consolidate;
  }
  if ("dedicated_equip" in payload) {
    mapped.dedicatedEquip = payload.dedicated_equip;
    delete mapped.dedicated_equip;
  }

  return mapped;
}

/**
 * Clear all line items for an order.
 * @param {string} orderId - Order ID
 * @returns {Promise<void>}
 */
export async function clearOrderLines(orderId) {
  return OrdersApi.clearLines(orderId);
}

/**
 * Copy an existing order with a new ID and "Unplanned" status.
 * Also duplicates the source order's line items so the new order
 * has the same freight composition as the original.
 * @param {object} source - The order to copy
 * @returns {Promise<object>} The newly created order
 */
export async function copyOrder(source) {
  const ts = Date.now().toString().slice(-6);
  const newId = `ORD-${new Date().getFullYear()}-${ts}`;
  const copy = {
    id: newId,
    customer: source.customer || null,
    origin: source.origin || null,
    dest: source.dest || null,
    origin_zip: source.origin_zip || null,
    dest_zip: source.dest_zip || null,
    ship_from_name: source.ship_from_name || source.shipFromName || null,
    ship_to_name: source.ship_to_name || source.shipToName || null,
    weight: source.weight || 0,
    pieces: source.pieces || 0,
    commodity: source.commodity || null,
    ready: source.ready || null,
    due: source.due || null,
    status: "Unplanned",
    shipment_id: null,
    ship_mode: source.ship_mode || null,
    incoterms: source.incoterms || null,
    preferred_carrier: source.preferred_carrier || null,
    excluded_carrier: source.excluded_carrier || null,
    no_consolidate: source.no_consolidate || false,
    hazmat: source.hazmat || false,
    no_contract_rate: source.no_contract_rate || false,
    dedicated_equip: source.dedicated_equip || false,
    notes: source.notes || null,
    po_number: source.po_number || source.po_num || null,
  };
  await DbApi.upsert("orders", copy);
  await copyOrderLines(source.id, newId);
  return copy;
}

/**
 * Duplicate order_lines from a source order onto a target order.
 * Backend POST /api/orders/:id/lines regenerates line ids from the
 * target order id and recalculates weight/pieces/line_count on the
 * target — so we strip identity fields before posting.
 * @param {string} sourceId
 * @param {string} targetId
 */
async function copyOrderLines(sourceId, targetId) {
  const sourceLines = await OrdersApi.lines(sourceId);
  if (!Array.isArray(sourceLines) || sourceLines.length === 0) return;
  const payload = sourceLines.map((l, i) => ({
    line_num: l.line_num || (i + 1),
    item_id: l.item_id || null,
    description: l.description || "",
    qty_ordered: l.qty_ordered || 0,
    unit_weight: l.unit_weight || 0,
    total_weight: l.total_weight || 0,
  }));
  await OrdersApi.saveLines(targetId, payload);
}

/* ── Internal helper: generate a shipment ID ── */
function genShipId() {
  return `SHP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

/**
 * Create shipments (MBOL + CBOLs) from a multi-stop route template.
 * Returns { masterShipment, childShipments, ordersUpdated, routePath, error }.
 */
export async function createShipmentsFromRoute(route, ordersList, rates = []) {
  const normalize = (s) => (s || "").trim().toLowerCase().split(",")[0].trim();
  const stops = Array.isArray(route.stops) ? route.stops : [];
  const pickups = stops.filter((s) => s.type === "pickup");
  const deliveries = stops.filter((s) => s.type === "delivery");
  const firstPickup = pickups[0] || stops[0];
  const lastDelivery = deliveries[deliveries.length - 1] || stops[stops.length - 1];
  const totalCost = parseFloat(route.cost_override) || 0;
  const totalMiles = parseFloat(route.total_miles) || 0;

  // Auto-assign orders to delivery stops by matching destination
  const assignments = {};
  for (const d of deliveries) {
    const dCity = normalize(d.location || d.city);
    const matched = ordersList.filter((o) => {
      const oCity = normalize(o.dest);
      return oCity.includes(dCity) || dCity.includes(oCity);
    });
    if (matched.length > 0) {
      const key = `${(firstPickup.stop_seq || 1)}.${d.stop_seq || d.sequence}`;
      assignments[key] = { delivery: d, orders: matched };
    }
  }

  if (Object.keys(assignments).length === 0) {
    return { masterShipment: null, childShipments: [], ordersUpdated: 0, routePath: "", error: "Could not match orders to route stops" };
  }

  const masterId = genShipId();
  const allOrderIds = ordersList.map((o) => o.id);
  const today = new Date().toISOString().slice(0, 10);
  const dueDates = ordersList.map((o) => o.due).filter(Boolean).sort();
  const routeTransitDays = parseInt(route.transit_days) || 2;
  // Delivery = earliest due date (must arrive by then)
  const deliveryDate = dueDates[0] || addBusinessDays(today, routeTransitDays);
  // Pickup = delivery - transit days (work backwards)
  let pickupDate = addBusinessDays(deliveryDate, -routeTransitDays);
  // If pickup is in the past, use today instead
  if (pickupDate < today) pickupDate = today;

  // Create MBOL — assign dock door 1 for the master pickup
  const mode = (route.mode || "TL").toUpperCase();
  const masterDock = buildDockFields({
    door: DOCK_DOORS[0],
    startTime: "06:00",
    duration: getLoadDuration(mode),
    pickupDate,
  });
  const masterShipment = {
    id: masterId, carrier: route.carrier, mode: route.mode || "TL",
    origin: firstPickup.location || `${firstPickup.city}, ${firstPickup.state}`,
    dest: lastDelivery.location || `${lastDelivery.city}, ${lastDelivery.state}`,
    weight: ordersList.reduce((s, o) => s + (parseFloat(o.weight) || 0), 0),
    pieces: ordersList.reduce((s, o) => s + (parseInt(o.pieces) || 0), 0),
    status: "Planned", total_cost: totalCost, order_ids: allOrderIds,
    miles: totalMiles, bol_type: "MBOL", bol_number: `MBOL-${masterId}`, route_template_id: route.id,
    pickup_date: pickupDate, delivery_date: deliveryDate,
    service_level: route.service_level || "Standard",
    dock_door: masterDock.dockDoor,
    dock_time: masterDock.dockTime,
    loading_start: masterDock.loadingStart,
    loading_end: masterDock.loadingEnd,
  };
  await DbApi.upsert("shipments", masterShipment);

  // Auto-generate BOL for master shipment (best-effort)
  saveDocument({
    id: `MBOL-${masterId}`, type: "BOL", status: "Pending", ship: masterId,
    carrier: masterShipment.carrier, generated: today,
    origin: masterShipment.origin, dest: masterShipment.dest,
    weight: masterShipment.weight, pieces: masterShipment.pieces,
    mode: masterShipment.mode, pickupDate, deliveryDate,
    orderIds: allOrderIds, bolType: "MBOL",
  }).catch(() => {});

  // Create CBOLs and update orders
  // Calculate leg miles from stops, or fetch via PC*Miler
  const cbolKeys = Object.keys(assignments);
  let totalLegMiles = 0;
  const cbolMilesMap = {};
  for (const [key, { delivery }] of Object.entries(assignments)) {
    const pIdx = stops.indexOf(firstPickup);
    const dIdx = stops.indexOf(delivery);
    let miles = 0;
    for (let i = pIdx + 1; i <= dIdx; i++) miles += parseFloat(stops[i].leg_miles) || 0;
    cbolMilesMap[key] = miles;
    totalLegMiles += miles;
  }
  // If no leg miles on stops, fetch from PC*Miler
  if (totalLegMiles === 0 && cbolKeys.length > 0) {
    try {
      const pairs = Object.entries(assignments).map(([, { delivery }]) => ({
        origin: firstPickup.location || `${firstPickup.city}, ${firstPickup.state}`,
        dest: delivery.location || `${delivery.city}, ${delivery.state}`,
      }));
      const mileageRes = await MileageApi.bulk(pairs);
      const results = Array.isArray(mileageRes?.results) ? mileageRes.results : (Array.isArray(mileageRes) ? mileageRes : []);
      cbolKeys.forEach((key, idx) => {
        const mi = parseFloat(results[idx]?.miles || results[idx]?.distance) || 0;
        cbolMilesMap[key] = mi;
        totalLegMiles += mi;
      });
    } catch { /* PC*Miler unavailable — fall through to equal split */ }
  }
  // If still 0, split cost equally
  const equalSplit = totalLegMiles === 0;

  const createdCbols = [];
  let cbolIdx = 0;
  for (const [key, { delivery, orders: cbolOrders }] of Object.entries(assignments)) {
    const childId = `${masterId}.${key}`;
    const legMiles = cbolMilesMap[key] || 0;
    const cbolCost = equalSplit
      ? Math.round((totalCost / cbolKeys.length) * 100) / 100
      : Math.round((legMiles / totalLegMiles) * totalCost * 100) / 100;

    const cbolOrigin = firstPickup.location || `${firstPickup.city}, ${firstPickup.state}`;
    const cbolDest = delivery.location || `${delivery.city}, ${delivery.state}`;
    // Look up rate ID by matching carrier + origin + dest
    const carrierNorm = normalize(route.carrier);
    const oNorm = normalize(cbolOrigin);
    const dNorm = normalize(cbolDest);
    const matchedRate = rates.find((r) => {
      const rc = normalize(r.carrier);
      const ro = normalize(r.origin);
      const rd = normalize(r.dest || r.destination);
      return (rc.includes(carrierNorm) || carrierNorm.includes(rc)) &&
             (ro.includes(oNorm) || oNorm.includes(ro)) &&
             (rd.includes(dNorm) || dNorm.includes(rd));
    });

    // Assign dock door round-robin across CBOLs
    const cbolDock = buildDockFields({
      door: DOCK_DOORS[cbolIdx % DOCK_DOORS.length],
      startTime: `${String(6 + cbolIdx % DOCK_DOORS.length).padStart(2, "0")}:00`,
      duration: getLoadDuration(mode),
      pickupDate,
    });

    await DbApi.upsert("shipments", {
      id: childId, carrier: route.carrier, mode: route.mode || "TL",
      origin: cbolOrigin, dest: cbolDest,
      weight: cbolOrders.reduce((s, o) => s + (parseFloat(o.weight) || 0), 0),
      pieces: cbolOrders.reduce((s, o) => s + (parseInt(o.pieces) || 0), 0),
      status: "Planned", total_cost: cbolCost, order_ids: cbolOrders.map((o) => o.id),
      miles: legMiles, bol_type: "CBOL", bol_number: `CBOL-${childId}`, master_shipment_id: masterId,
      stop_from: key.split(".")[0], stop_to: key.split(".")[1],
      route_template_id: route.id,
      pickup_date: pickupDate, delivery_date: deliveryDate,
      service_level: route.service_level || "Standard",
      rate_id: matchedRate ? (matchedRate.lane || matchedRate.id) : null,
      equipment: matchedRate?.equipment ?? null,
      dock_door: cbolDock.dockDoor,
      dock_time: cbolDock.dockTime,
      loading_start: cbolDock.loadingStart,
      loading_end: cbolDock.loadingEnd,
    });
    cbolIdx++;
    createdCbols.push({ id: childId, origin: cbolOrigin, dest: cbolDest, cost: cbolCost, miles: legMiles, orders: cbolOrders });

    // Auto-generate BOL for child shipment (best-effort)
    saveDocument({
      id: `CBOL-${childId}`, type: "BOL", status: "Pending", ship: childId,
      carrier: route.carrier, generated: today,
      origin: cbolOrigin, dest: cbolDest,
      weight: cbolOrders.reduce((s, o) => s + (parseFloat(o.weight) || 0), 0),
      pieces: cbolOrders.reduce((s, o) => s + (parseInt(o.pieces) || 0), 0),
      mode: route.mode || "TL", pickupDate, deliveryDate,
      orderIds: cbolOrders.map((o) => o.id), bolType: "CBOL",
    }).catch(() => {});

    for (const ord of cbolOrders) {
      const cleanNotes = (ord.notes || "").replace(PLANNING_FAILED_REGEX, "").trim();
      await DbApi.patch("orders", ord.id, { status: "Planned", shipment_id: childId, notes: cleanNotes || null });
    }
  }

  // Build full route path from stops
  const routePath = stops.map((s) => (s.city || (s.location || "").split(",")[0] || "").trim()).filter(Boolean).join(" \u2192 ");

  return {
    masterShipment: { ...masterShipment, routePath },
    childShipments: createdCbols,
    ordersUpdated: ordersList.length,
    routePath,
    error: null,
  };
}

/**
 * Unplan an order and clean up its shipment cascade (CBOL -> MBOL).
 * Returns { message, deletedShipments }.
 */
export async function unplanOrderFromShipment(id, orders, shipments) {
  const deletedShipments = [];
  const order = orders.find((o) => o.id === id);
  const shipmentId = order?.shipment_id;
  // REQ-02: use the domain endpoint (/api/orders/:id) so the backend
  // records per-field 'edit' events AND a dedicated 'unassign' event
  // when shipment_id clears. The generic DbApi.patch skips the hook.
  await OrdersApi.update(id, { status: "Unplanned", shipmentId: null });

  let message = `Order ${id} unplanned`;

  if (shipmentId) {
    const ship = shipments.find((s) => s.id === shipmentId);

    // Remove this order from the shipment's order_ids array
    const updatedOrderIds = (ship?.order_ids || []).filter((oid) => oid !== id);

    if (updatedOrderIds.length === 0) {
      // No orders remain — delete the shipment
      await DbApi.remove("shipments", shipmentId).catch(() => {});
      deletedShipments.push(shipmentId);
      // If it was a CBOL, check if the MBOL has any remaining CBOLs
      if (ship?.master_shipment_id) {
        const siblingCbols = shipments.filter((s) => s.master_shipment_id === ship.master_shipment_id && s.id !== shipmentId);
        if (siblingCbols.length === 0) {
          await DbApi.remove("shipments", ship.master_shipment_id).catch(() => {});
          deletedShipments.push(ship.master_shipment_id);
          message = `Order ${id} unplanned. Shipment ${shipmentId} and master ${ship.master_shipment_id} deleted.`;
        } else {
          message = `Order ${id} unplanned. Shipment ${shipmentId} deleted.`;
        }
      } else {
        message = `Order ${id} unplanned. Shipment ${shipmentId} deleted.`;
      }
    } else {
      // Other orders remain — update the shipment's order_ids to remove this order
      await DbApi.patch("shipments", shipmentId, { order_ids: updatedOrderIds });
      message = `Order ${id} unplanned and removed from shipment ${shipmentId}.`;
    }
  }

  return { message, deletedShipments };
}

/**
 * Execute a set of plans via the BulkPlanApi and normalize the response
 * into a UI-friendly result.
 *
 * The backend `/bulk-plan/execute` endpoint returns
 *   { shipments: [...], ordersUpdated: N, errors: [...] }
 * and can come back with errors populated but shipments empty when a row
 * insert is rejected (e.g. missing column, constraint violation). Rather
 * than leak that interpretation into every caller, we collapse the
 * response here into:
 *   { ok, errorMessage, shipments, ordersUpdated, rawErrors }
 *
 * Callers can render `errorMessage` directly when `!ok`, and trust
 * `shipments` / `ordersUpdated` only when `ok` is true.
 */
export async function executeSinglePlan(plans) {
  const raw = await BulkPlanApi.execute(plans);
  const shipments = Array.isArray(raw?.shipments) ? raw.shipments : [];
  const rawErrors = Array.isArray(raw?.errors) ? raw.errors : [];
  const ordersUpdated = Number(raw?.ordersUpdated) || 0;
  const hasErrors = rawErrors.length > 0;
  const ok = shipments.length > 0 && !hasErrors;
  const errorMessage = ok
    ? ""
    : (rawErrors[0]?.error || (shipments.length === 0 ? "No shipments created" : "Planning completed with errors"));
  return { ok, errorMessage, shipments, ordersUpdated, rawErrors };
}

/**
 * Fetch carrier quotes for a lane, sorted: feasible (on-time) first, then by cost ascending.
 * @param {object}   lane         - Lane object with origin, dest, weights, etc.
 * @param {function} calcDatesFn  - Function(quote, dueDate, readyDate) => { warning, ... }
 * @param {string}   dueDate      - Earliest due date (ISO string)
 * @param {string}   readyDate    - Latest ready date (ISO string)
 */
export async function fetchCarrierQuotes(lane, calcDatesFn, dueDate, readyDate, options = {}) {
  const key = quoteCacheKey(lane);
  const now = Date.now();
  const cached = quoteCache.get(key);

  let rawQuotes = [];
  let bestQuote = null;
  if (cached && now - cached.ts < QUOTE_CACHE_TTL_MS) {
    rawQuotes = cached.rawQuotes;
    bestQuote = cached.bestQuote;
  } else {
    const rateRes = await BulkPlanApi.rate([lane], "cost", options);
    const results = Array.isArray(rateRes?.results) ? rateRes.results : [];
    rawQuotes = results[0]?.quotes || [];
    bestQuote = results[0]?.bestQuote || null;
    quoteCache.set(key, { ts: now, rawQuotes, bestQuote });
  }

  // REQ-09 + REQ-10: honour the order's mode AND service-level constraints.
  // A lane carrying either constraint filters the quote list down before
  // sorting, and bestQuote is recomputed from the constrained pool. A
  // lane with no constraints keeps legacy behaviour.
  const modeConstraint = normalizeMode(lane?.modeConstraint);
  const slConstraint = normalizeServiceLevel(lane?.serviceLevelConstraint);
  let workingQuotes = rawQuotes;
  let workingBest = bestQuote;
  if (modeConstraint || slConstraint) {
    workingQuotes = rawQuotes.filter((q) => {
      if (modeConstraint && normalizeMode(q?.mode) !== modeConstraint) return false;
      if (slConstraint && normalizeServiceLevel(q?.serviceLevel) !== slConstraint) return false;
      return true;
    });
    workingBest = workingQuotes[0] || null;
    // If the legacy bestQuote already matches every constraint, keep it
    // as the starting point so we don't unnecessarily change the choice.
    if (
      bestQuote &&
      (!modeConstraint || normalizeMode(bestQuote.mode) === modeConstraint) &&
      (!slConstraint || normalizeServiceLevel(bestQuote.serviceLevel) === slConstraint)
    ) {
      workingBest = bestQuote;
    }
  }

  // Sort: feasible first, then by cost ascending.
  //
  // "Feasible" here means the quote can actually be planned — it has a
  // real transit time AND, if dates were supplied, calcDatesFn doesn't
  // flag the delivery as late. A quote without transitDays returns
  // calcDates({ error }) (NOT { warning }), so we must check transit
  // explicitly — otherwise no-transit quotes tie with on-time quotes
  // on the warning key and the cost tiebreaker can pick an unplannable
  // carrier (e.g. ODFL with no CC transit beating AVERITT @ 4d when
  // both cost the same).
  const isFeasible = (q) => {
    if (!q || !(Number(q.transitDays) > 0)) return false;
    if (!calcDatesFn) return true;
    const d = calcDatesFn(q, dueDate, readyDate);
    return !d.error && !d.warning;
  };
  const sortedQuotes = [...workingQuotes].sort((a, b) => {
    const fa = isFeasible(a) ? 0 : 1;
    const fb = isFeasible(b) ? 0 : 1;
    if (fa !== fb) return fa - fb; // feasible first
    // Lane-preference matching tier: quotes that satisfy the lane pref
    // (mode etc.) rank above quotes that don't. Non-matching quotes are
    // not hidden — they show as fallback options below. Mirrors the
    // server-side comparator at api/server.js.
    const aMatch = a.matchesLanePref !== false;
    const bMatch = b.matchesLanePref !== false;
    if (aMatch && !bMatch) return -1;
    if (!aMatch && bMatch) return 1;
    // Preferred carriers boosted within each pref-match tier.
    if (a.preferred && !b.preferred) return -1;
    if (!a.preferred && b.preferred) return 1;
    return (a.totalCharge || 0) - (b.totalCharge || 0); // then cheapest
  });

  // After sorting, the first feasible-and-cheapest quote is the "best".
  // Always promote feasible-first (not only under constraints) — bulk
  // planners use bestQuote directly, and the rule is: prefer the cheapest
  // FEASIBLE carrier; only fall back to the cheapest infeasible quote so
  // the caller's dates.warning / dates.error path can surface a clear
  // failure reason. The Plan modal pre-selects bestQuote too, so this
  // also makes the modal's default selection a sane on-time pick.
  const firstFeasible = sortedQuotes.find(isFeasible);
  workingBest = firstFeasible || sortedQuotes[0] || null;

  return { quotes: sortedQuotes, bestQuote: workingBest };
}

/**
 * Warm quote cache in background for likely plan candidates.
 * Best-effort: failures are intentionally swallowed.
 */
export async function prefetchCarrierQuotes(lane) {
  try {
    const key = quoteCacheKey(lane);
    const now = Date.now();
    const cached = quoteCache.get(key);
    if (cached && now - cached.ts < QUOTE_CACHE_TTL_MS) return;
    const rateRes = await BulkPlanApi.rate([lane], "cost");
    const results = Array.isArray(rateRes?.results) ? rateRes.results : [];
    const rawQuotes = results[0]?.quotes || [];
    const bestQuote = results[0]?.bestQuote || null;
    quoteCache.set(key, { ts: now, rawQuotes, bestQuote });
  } catch {
    // Prefetch must never block UI or throw.
  }
}

/**
 * Get order ready/due date helpers.
 */
function getOrderReady(o) {
  return o.ready || o.pickup_date || o.ready_date || null;
}
function getOrderDue(o) {
  return o.due || o.delivery_date || o.due_date || null;
}

/**
 * Check if a group of orders can ship together given actual transit days.
 * Returns true if latest ready + transit days <= earliest due.
 * @param {Object[]} orders - orders in the group
 * @param {number} transitDays - actual transit days from carrier (CarrierConnect or rates table)
 */
export function datesCompatibleWithTransit(orders, transitDays) {
  if (!transitDays || orders.length <= 1) return true;

  const readyDates = orders.map(getOrderReady).filter(Boolean);
  const dueDates = orders.map(getOrderDue).filter(Boolean);
  if (!readyDates.length || !dueDates.length) return true;

  const latestReady = readyDates.sort().reverse()[0];
  const earliestDue = dueDates.sort()[0];

  const estDelivery = addBusinessDays(latestReady, transitDays);
  const ok = estDelivery <= earliestDue;

  if (!ok) {
    console.log(`[datesCompatible] INCOMPATIBLE: latestReady=${latestReady} + ${transitDays}d transit → delivery=${estDelivery} > earliestDue=${earliestDue}`);
  }
  return ok;
}

/**
 * Split orders into groups that fit under a weight limit.
 * Uses first-fit decreasing bin packing.
 * Date compatibility is checked AFTER rating when actual transit is known.
 */
export function splitOrdersByWeight(orders, maxWeight = 15000) {
  const sorted = [...orders].sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0));
  const bins = [];

  for (const order of sorted) {
    const w = Number(order.weight || 0);
    let placed = false;
    for (const bin of bins) {
      if (bin.weight + w <= maxWeight) {
        bin.orders.push(order);
        bin.weight += w;
        placed = true;
        break;
      }
    }
    if (!placed) {
      bins.push({ orders: [order], weight: w });
    }
  }

  return bins.map((b) => b.orders);
}

/**
 * Build shipment groups from orders — split by weight limit.
 * Date compatibility is checked AFTER rating when actual carrier transit days are known.
 * Returns array of { lane, orders } objects.
 */
export function buildShipmentGroups(orders, baseLane, maxWeight = 15000) {
  const totalWeight = orders.reduce((s, o) => s + Number(o.weight || 0), 0);

  // If total fits under limit, return single group
  if (totalWeight <= maxWeight) {
    return [{ lane: baseLane, orders }];
  }

  // Split into groups by weight only
  const groups = splitOrdersByWeight(orders, maxWeight);
  console.log(`[buildShipmentGroups] totalWeight=${totalWeight} → ${groups.length} groups by weight`);
  return groups.map((groupOrders) => {
    const groupWeight = groupOrders.reduce((s, o) => s + Number(o.weight || 0), 0);
    const groupPieces = groupOrders.reduce((s, o) => s + Number(o.pieces || 0), 0);
    return {
      lane: {
        ...baseLane,
        totalWeight: groupWeight,
        totalPieces: groupPieces,
        orderIds: groupOrders.map((o) => o.id),
      },
      orders: groupOrders,
    };
  });
}

/**
 * Bulk-plan all unplanned orders: same logic as Plan Group.
 * 1. Group by lane
 * 2. Group by equipment weight (TL max if over LTL)
 * 3. Rate each group
 * 4. Check date compatibility with actual transit
 * 5. Split incompatible orders and re-rate individually
 * 6. Execute plans
 * Returns { created, updated, cost, noQuotes, shipments, plans }.
 */
export async function bulkPlanOrders(unplannedOrders, existingShipments = [], dockEnabled = true, dockConfigs = []) {
  if (!unplannedOrders.length) {
    return { created: 0, updated: 0, cost: 0, noQuotes: true, failures: [] };
  }

  // REQ-28: accumulate per-order failure reasons. See
  // services/bulkPlanFailureCollector.js — every drop point below calls
  // `failures.add(orderId, code, details?)` (or `.addMany(orders, code)`
  // for shipment-group-level drops) instead of silently returning null.
  const failures = createFailureCollector();

  const { LTL_MAX_WEIGHT: LTL_MAX, TL_MAX_WEIGHT: TL_MAX } = await import("../constants/orders.js");
  const { calcDates } = await import("./bulkPlanService.js");

  // Group by lane + REQ-09 mode + REQ-10 service level constraints.
  // Orders on the same lane but with different explicit ship_modes OR
  // different service levels must NOT consolidate — otherwise the
  // constraints get diluted. Orders without explicit values fall into
  // a shared "any" bucket and behave as before.
  const normLane = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const laneMap = {};
  unplannedOrders.forEach((o) => {
    const mc = normalizeMode(o.ship_mode || o.shipMode);
    const sl = normalizeServiceLevel(o.service_level || o.serviceLevel);
    const key = `${normLane(o.origin)}||${normLane(o.dest)}||${mc || "any"}||${sl || "any"}`;
    if (!laneMap[key]) laneMap[key] = [];
    laneMap[key].push(o);
  });

  // REQ-05 perf: rate every lane in parallel via Promise.all. Each
  // lane-worker emits its own local plan list, then we concatenate.
  const laneWorkers = Object.values(laneMap).map(async (laneOrders) => {
    const lanePlans = [];
    const o = laneOrders[0];
    const totalWeight = laneOrders.reduce((s, x) => s + Number(x.weight || 0), 0);
    const originZip = String(o.origin_zip || o.origin || "").match(/\b(\d{5})\b/)?.[1] || "";
    const destZip = String(o.dest_zip || o.dest || "").match(/\b(\d{5})\b/)?.[1] || "";

    // REQ-09 + REQ-10: because the lane map now splits by both mode and
    // service level, every order in this bucket shares the same pair of
    // constraints (possibly empty). Pin them on the lane so rating
    // honours them.
    const laneModeConstraint = commonModeConstraint(laneOrders);
    const laneServiceLevelConstraint = commonServiceLevelConstraint(laneOrders);
    // Use equipment max weight. If the mode constraint is explicitly LTL,
    // force the LTL ceiling so we never build a TL group; if it's TL,
    // always go to TL capacity. Without a constraint, fall back to the
    // historical weight heuristic.
    const equipMaxWeight = laneModeConstraint === "LTL"
      ? LTL_MAX
      : laneModeConstraint === "TL"
        ? TL_MAX
        : (totalWeight <= LTL_MAX ? LTL_MAX : TL_MAX);
    const groups = buildShipmentGroups(laneOrders, {
      laneKey: buildLaneKey(o), origin: o.origin || "", destination: o.dest || "",
      originZip, destZip, freightClass: o.freight_class || "70",
      totalWeight, totalPieces: laneOrders.reduce((s, x) => s + Number(x.pieces || 0), 0),
      orderIds: laneOrders.map((x) => x.id),
      // REQ-09
      modeConstraint: laneModeConstraint || "",
      // REQ-10
      serviceLevelConstraint: laneServiceLevelConstraint || "",
    }, equipMaxWeight);

    // REQ-05 perf: first-pass rating for every group in this lane runs
    // in parallel (typically 1-2 groups per lane, but still a small win).
    const initialRates = await Promise.all(groups.map(async (sg) => {
      const readyD = sg.orders.map((s) => s.ready).filter(Boolean).sort().reverse()[0] || "";
      const dueD = sg.orders.map((s) => s.due).filter(Boolean).sort()[0] || "";
      const { quotes, bestQuote } = await fetchCarrierQuotes(sg.lane, calcDates, dueD, readyD);
      return { sg, readyD, dueD, quotes, bestQuote };
    }));

    // Handle each rated group sequentially — the subset-rerating code path
    // is rare and keeps nicer flow when serial, avoiding over-parallelism.
    for (const { sg, readyD, dueD, bestQuote } of initialRates) {
      if (!bestQuote) {
        // REQ-28: no carrier returned a quote for this shipment-group lane.
        // `dropReasonForLane` picks MODE/SERVICE_LEVEL/NO_QUOTE based on the
        // constraints the group was carrying, so the UI shows the most
        // specific reason available.
        failures.addMany(
          sg.orders,
          dropReasonForLane(laneModeConstraint, laneServiceLevelConstraint),
        );
        continue;
      }

      const transit = bestQuote.transitDays;

      // Check date compatibility with actual transit — same as Plan Group
      if (sg.orders.length > 1 && transit && !datesCompatibleWithTransit(sg.orders, transit)) {
        // Find best compatible subset — same logic as Plan Group
        const sorted = [...sg.orders].sort((a, b) =>
          (a.due || a.delivery_date || "9999").localeCompare(b.due || b.delivery_date || "9999")
        );

        let bestSubset = null;
        for (let size = sorted.length - 1; size >= 2; size--) {
          for (let skip = 0; skip < sorted.length; skip++) {
            const subset = sorted.filter((_, idx) => idx !== skip);
            if (subset.length === size && datesCompatibleWithTransit(subset, transit)) {
              bestSubset = subset;
              break;
            }
          }
          if (bestSubset) break;
        }

        if (bestSubset) {
          // Rate consolidated subset
          const subsetWeight = bestSubset.reduce((s, x) => s + Number(x.weight || 0), 0);
          const subsetLane = { ...sg.lane, totalWeight: subsetWeight, totalPieces: bestSubset.reduce((s, x) => s + Number(x.pieces || 0), 0), orderIds: bestSubset.map(x => x.id) };
          const subReadyD = bestSubset.map(s => s.ready).filter(Boolean).sort().reverse()[0] || "";
          const subDueD = bestSubset.map(s => s.due).filter(Boolean).sort()[0] || "";
          const { bestQuote: subBest } = await fetchCarrierQuotes(subsetLane, calcDates, subDueD, subReadyD);
          if (!subBest) {
            // REQ-28: subset couldn't be rated — mark each order as no quote.
            failures.addMany(bestSubset, FAILURE_CODES.NO_CARRIER_QUOTE);
          } else {
            const dates = calcDates(subBest, subDueD, subReadyD);
            // Bulk / Plan-Selected fail orders when the chosen quote can't
            // honour ready/due — `error` (no transit) OR `warning` (transit
            // overshoots due date). Only the single Plan modal allows the
            // user to override an infeasible carrier.
            if (dates.error || dates.warning) {
              failures.addMany(bestSubset, FAILURE_CODES.DATES_INCOMPATIBLE, dates.error || dates.warning);
            } else {
              lanePlans.push({
                laneKey: subsetLane.laneKey, origin: subsetLane.origin, destination: subsetLane.destination,
                originZip: subsetLane.originZip, destZip: subsetLane.destZip,
                totalWeight: subsetLane.totalWeight, totalPieces: subsetLane.totalPieces, orderIds: subsetLane.orderIds,
                carrier: subBest.carrier || "", mode: subBest.mode || "LTL",
                totalCost: subBest.totalCharge || 0, pickupDate: dates.pickup, deliveryDate: dates.delivery,
                czarliteRate: subBest.mode === "LTL", serviceLevel: subBest.serviceLevel || "Standard",
                miles: subBest.miles || null, rateId: subBest.rateId || null,
                // Mirror confirmPlan/buildPlan — without these the shipment
                // row lands with rate/fuel_surcharge/accessorials = 0 even
                // when the matched rate had a non-zero FSC, so the Shipment
                // Details modal renders "Fuel Surcharge $0" against a 10%
                // rate (e.g. SHP-2026-9818).
                rate:          subBest.czarBaseGross || subBest.czarBase || 0,
                fuelSurcharge: subBest.fscCharge || 0,
                accessorials:  subBest.accessorialCharge || 0,
                // Migration 025: snapshot the chosen rate's equipment onto the plan.
                equipment: subBest.equipment || null,
              });
            }
          }

          // Rate remainder individually — parallelize these too since each
          // order is independent of the others on the same lane.
          const remainder = sg.orders.filter(x => !bestSubset.some(s => s.id === x.id));
          const remainderResults = await Promise.all(remainder.map(async (order) => {
            const singleLane = { ...sg.lane, totalWeight: Number(order.weight || 0), totalPieces: Number(order.pieces || 0), orderIds: [order.id] };
            const { bestQuote: indBest } = await fetchCarrierQuotes(singleLane, calcDates, order.due || "", order.ready || "");
            if (!indBest) {
              // REQ-28: the individual re-rate returned no usable carrier.
              failures.add(order.id, FAILURE_CODES.NO_CARRIER_QUOTE);
              return null;
            }
            const dates = calcDates(indBest, order.due || "", order.ready || "");
            if (dates.error || dates.warning) {
              failures.add(order.id, FAILURE_CODES.DATES_INCOMPATIBLE, dates.error || dates.warning);
              return null;
            }
            return {
              laneKey: singleLane.laneKey, origin: singleLane.origin, destination: singleLane.destination,
              originZip: singleLane.originZip, destZip: singleLane.destZip,
              totalWeight: singleLane.totalWeight, totalPieces: singleLane.totalPieces, orderIds: [order.id],
              carrier: indBest.carrier || "", mode: indBest.mode || "LTL",
              totalCost: indBest.totalCharge || 0, pickupDate: dates.pickup, deliveryDate: dates.delivery,
              czarliteRate: indBest.mode === "LTL", serviceLevel: indBest.serviceLevel || "Standard",
              miles: indBest.miles || null, rateId: indBest.rateId || null,
              rate:          indBest.czarBaseGross || indBest.czarBase || 0,
              fuelSurcharge: indBest.fscCharge || 0,
              accessorials:  indBest.accessorialCharge || 0,
              equipment: indBest.equipment || null,
            };
          }));
          for (const r of remainderResults) if (r) lanePlans.push(r);
        } else {
          // No compatible subset — plan all individually (in parallel).
          const indivResults = await Promise.all(sg.orders.map(async (order) => {
            const singleLane = { ...sg.lane, totalWeight: Number(order.weight || 0), totalPieces: Number(order.pieces || 0), orderIds: [order.id] };
            const { bestQuote: indBest } = await fetchCarrierQuotes(singleLane, calcDates, order.due || "", order.ready || "");
            if (!indBest) {
              failures.add(order.id, FAILURE_CODES.NO_CARRIER_QUOTE);
              return null;
            }
            const dates = calcDates(indBest, order.due || "", order.ready || "");
            if (dates.error || dates.warning) {
              failures.add(order.id, FAILURE_CODES.DATES_INCOMPATIBLE, dates.error || dates.warning);
              return null;
            }
            return {
              laneKey: singleLane.laneKey, origin: singleLane.origin, destination: singleLane.destination,
              originZip: singleLane.originZip, destZip: singleLane.destZip,
              totalWeight: singleLane.totalWeight, totalPieces: singleLane.totalPieces, orderIds: [order.id],
              carrier: indBest.carrier || "", mode: indBest.mode || "LTL",
              totalCost: indBest.totalCharge || 0, pickupDate: dates.pickup, deliveryDate: dates.delivery,
              czarliteRate: indBest.mode === "LTL", serviceLevel: indBest.serviceLevel || "Standard",
              miles: indBest.miles || null, rateId: indBest.rateId || null,
              rate:          indBest.czarBaseGross || indBest.czarBase || 0,
              fuelSurcharge: indBest.fscCharge || 0,
              accessorials:  indBest.accessorialCharge || 0,
              equipment: indBest.equipment || null,
            };
          }));
          for (const r of indivResults) if (r) lanePlans.push(r);
        }
      } else {
        // Dates compatible or single order — plan as-is
        const dates = calcDates(bestQuote, dueD, readyD);
        if (dates.error || dates.warning) {
          // REQ-28 + feasibility rule: the single best quote's transit
          // doesn't honour ready/due. Fail every order in this group with
          // DATES_INCOMPATIBLE so Bulk Plan / Plan Selected surface a
          // clear reason in the results panel. The user can re-plan a
          // failed order through the single Plan modal and pick an
          // infeasible carrier manually if the SLA is intentionally
          // being relaxed.
          failures.addMany(sg.orders, FAILURE_CODES.DATES_INCOMPATIBLE, dates.error || dates.warning);
        } else {
          lanePlans.push({
            laneKey: sg.lane.laneKey, origin: sg.lane.origin, destination: sg.lane.destination,
            originZip: sg.lane.originZip, destZip: sg.lane.destZip,
            totalWeight: sg.lane.totalWeight, totalPieces: sg.lane.totalPieces, orderIds: sg.lane.orderIds,
            carrier: bestQuote.carrier || "", mode: bestQuote.mode || "LTL",
            totalCost: bestQuote.totalCharge || 0, pickupDate: dates.pickup, deliveryDate: dates.delivery,
            czarliteRate: bestQuote.mode === "LTL", serviceLevel: bestQuote.serviceLevel || "Standard",
            miles: bestQuote.miles || null, rateId: bestQuote.rateId || null,
            rate:          bestQuote.czarBaseGross || bestQuote.czarBase || 0,
            fuelSurcharge: bestQuote.fscCharge || 0,
            accessorials:  bestQuote.accessorialCharge || 0,
            equipment: bestQuote.equipment || null,
          });
        }
      }
    }
    return lanePlans;
  });

  // Wait for every lane-worker and flatten their plans.
  const laneResults = await Promise.all(laneWorkers);
  const allPlans = laneResults.flat();

  if (!allPlans.length) {
    // REQ-28: even with zero shipments created, hand every failure back so
    // the UI can render reasons and the Excel export has data.
    return { created: 0, updated: 0, cost: 0, noQuotes: true, failures: failures.list() };
  }

  // Auto-assign dock doors to all plans via dock service
  // Auto-assign dock doors when dock scheduling is enabled
  if (dockEnabled) {
    assignDocksToPlans(allPlans, existingShipments, dockConfigs);
  } else {
    // No dock assignment — just set pickup time to warehouse start hour
    for (const plan of allPlans) {
      const wh = getDockConfigForWarehouse(dockConfigs, plan.origin);
      plan.pickupTime = `${String(wh.startHour || 6).padStart(2, "0")}:00`;
    }
  }

  try {
    const execRes = await BulkPlanApi.execute(allPlans);
    const shipments = execRes?.shipments || [];
    const backendErrors = Array.isArray(execRes?.errors) ? execRes.errors : [];

    // REQ-28: correlate backend errors back to orders via the collector.
    // mapBackendErrorsToOrders handles the laneKey → orderIds lookup and
    // skips orders that survived on a different shipment.
    const plannedOrderIds = new Set(
      shipments.flatMap((sh) => Array.isArray(sh.order_ids) ? sh.order_ids : [])
    );
    const backendFailures = mapBackendErrorsToOrders({
      backendErrors,
      plans: allPlans,
      plannedOrderIds,
    });
    for (const f of backendFailures) failures.add(f.orderId, f.code, f.details);

    return {
      created: shipments.length,
      updated: execRes?.ordersUpdated || 0,
      cost: shipments.reduce((s, sh) => s + Number(sh.total_cost || 0), 0),
      shipments,
      plans: allPlans,
      failures: failures.list(),
      backendErrors,
      noQuotes: false,
    };
  } catch (err) {
    throw err;
  }
}

/**
 * Find a route template whose pickup/delivery stops match the orders' origins/dests.
 * Returns { route, matchedOrders } or null if no template matches 2+ orders.
 */
export function findMatchingRoute(templates, orders) {
  const normalize = (s) => (s || "").trim().toLowerCase().split(",")[0].trim();

  for (const t of templates) {
    if (!t.carrier) continue;
    const tStops = Array.isArray(t.stops) ? t.stops : [];
    const tPickups = tStops.filter((s) => s.type === "pickup").map((s) => normalize(s.location || s.city));
    const tDeliveries = tStops.filter((s) => s.type === "delivery").map((s) => normalize(s.location || s.city));

    // Find orders that match this route (origin matches a pickup, dest matches a delivery)
    const matched = orders.filter((o) => {
      const oOrigin = normalize(o.origin);
      const oDest = normalize(o.dest);
      return tPickups.some((p) => oOrigin.includes(p) || p.includes(oOrigin))
        && tDeliveries.some((td) => oDest.includes(td) || td.includes(oDest));
    });

    // Only use multi-stop route if matched orders have 2+ different destinations
    const uniqueDests = new Set(matched.map((o) => normalize(o.dest)));
    if (matched.length >= 2 && uniqueDests.size >= 2) {
      return { route: t, matchedOrders: matched };
    }
  }

  return null;
}

/* ═══════════════════════════════════════════════════════════════════════
 *  Planning Failure — service functions
 * ═══════════════════════════════════════════════════════════════════════ */

const PLANNING_FAILED_REGEX = /\n?PLANNING FAILED:.*$/gm;

/**
 * Check if an order is in a plannable state (Unplanned or Planning Failed).
 * @param {object} order
 * @returns {boolean}
 */
export function isPlannable(order) {
  return order.status === "Unplanned" || order.status === "Planning Failed";
}

/**
 * Clean up stale shipment_id references on Unplanned orders.
 * Returns the number of orders cleaned.
 * @param {object[]} orders - Full orders list
 * @returns {Promise<number>}
 */
export async function cleanupStaleShipmentRefs(orders) {
  const stale = orders.filter((o) => o.status === "Unplanned" && o.shipment_id);
  if (stale.length === 0) return 0;
  await Promise.all(stale.map((o) => DbApi.patch("orders", o.id, { shipment_id: null })));
  return stale.length;
}

/**
 * Validate orders for past due dates and mark them as "Planning Failed".
 * Returns { failed, valid } arrays.
 * @param {object[]} orders - Orders to validate
 * @returns {Promise<{ failed: object[], valid: object[] }>}
 */
export async function validateAndFailPastDueOrders(orders) {
  const today = new Date().toISOString().slice(0, 10);
  const failed = orders.filter((o) => o.due && o.due < today);
  const valid = orders.filter((o) => !o.due || o.due >= today);

  if (failed.length > 0) {
    await Promise.all(failed.map((o) => {
      const cleanNotes = (o.notes || "").replace(PLANNING_FAILED_REGEX, "").trim();
      return DbApi.patch("orders", o.id, {
        status: "Planning Failed",
        notes: (cleanNotes ? cleanNotes + "\n" : "") + `PLANNING FAILED: due date ${o.due} is in the past`,
      });
    }));
  }

  return { failed, valid };
}

/**
 * Clear "PLANNING FAILED:" notes from orders after successful planning.
 * Only patches orders that actually have failure notes.
 * @param {object[]} orders - Orders to clean
 * @returns {Promise<void>}
 */
export async function clearPlanningFailureNotes(orders) {
  const withFailNotes = orders.filter((o) => o.notes && PLANNING_FAILED_REGEX.test(o.notes));
  // Reset regex lastIndex after .test()
  PLANNING_FAILED_REGEX.lastIndex = 0;
  if (withFailNotes.length === 0) return;
  await Promise.all(withFailNotes.map((o) => {
    const cleanNotes = o.notes.replace(PLANNING_FAILED_REGEX, "").trim();
    return DbApi.patch("orders", o.id, { notes: cleanNotes || null });
  }));
}
