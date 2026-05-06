import { OrdersApi, ShipmentsApi } from "../lib/api";
import { emptyLocation, locationsToShipmentPatch } from "../types/location";

/**
 * Generate a unique shipment ID.
 */
export function generateShipmentId() {
  return `SHP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

/**
 * Build a blank shipment object with defaults.
 */
export function buildBlankShipment() {
  // REQ-24 refactor — UI form state uses the canonical `shipFrom` /
  // `shipTo` Location shape. The submit boundary (NewShipmentModal →
  // createShipment) is responsible for mapping these to the DB columns
  // via `locationsToShipmentPatch` so the form state stays UI-shaped.
  return {
    shipFrom: emptyLocation(),
    shipTo:   emptyLocation(),
    mode: "LTL",
    carrier: "",
    weight: 0,
    pieces: 0,
    total_cost: 0,
    status: "Planned",
    pickup_date: new Date().toISOString().slice(0, 10),
    delivery_date: "",
    service_level: "Standard",
    // Migration 025: shipments.equipment is a soft reference to
    // equipment_types.name. Manual creates leave it blank by default
    // and let the user pick from the master list.
    equipment: "",
    notes: "",
  };
}

/**
 * Normalize a value bound for a Postgres `date` column. The HTML date
 * input emits "" when blank, but PG rejects empty strings on `date`
 * columns (SQLSTATE 22007). Any blank/whitespace value becomes NULL so
 * the upsert succeeds.
 */
function normalizeDate(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}

/**
 * Create a new shipment in the database.
 * @param {Object} shipmentData - The shipment fields from the form.
 * @returns {Object} The created shipment with generated ID.
 */
export async function createShipment(shipmentData) {
  const id = generateShipmentId();
  const equipment = typeof shipmentData.equipment === "string"
    ? shipmentData.equipment.trim()
    : shipmentData.equipment;
  const shipment = {
    id,
    ...shipmentData,
    weight: parseFloat(shipmentData.weight) || 0,
    pieces: parseInt(shipmentData.pieces) || 0,
    total_cost: parseFloat(shipmentData.total_cost) || 0,
    equipment: equipment || null,
    pickup_date: normalizeDate(shipmentData.pickup_date),
    delivery_date: normalizeDate(shipmentData.delivery_date),
    status: "Planned",
  };
  // Routed through the dedicated endpoint so the backend records a
  // 'create' change_history row — the Shipment Details timeline reads
  // this to render the "Order Created & Rate Confirmed" timestamp.
  await ShipmentsApi.create(shipment);
  return shipment;
}

/**
 * Migration 032: snapshot the source shipment's line items so the
 * Copy Shipment lands with a populated Line Items table even though
 * the copy intentionally does not create new orders.
 *
 * Reads via OrdersApi.lines for each linked order (same endpoint the
 * modal already uses on every open), flattens, and normalizes to the
 * shape stored in `shipments.line_items` JSONB:
 *   { order_id, line_num, item_id, description,
 *     qty_ordered, unit_weight, total_weight }
 *
 * Sorted (order_id, line_num) so the copied JSONB matches the
 * deterministic ordering the SQL backfill produces (jsonb_agg
 * ORDER BY ol.order_id, ol.line_num) and the modal's per-order
 * grouping. Failures fall through to [] so the copy never breaks
 * over a snapshot read.
 */
async function buildLineItemsSnapshot(linkedOrders) {
  if (!Array.isArray(linkedOrders) || linkedOrders.length === 0) return [];
  try {
    const perOrder = await Promise.all(
      linkedOrders.map((o) =>
        OrdersApi.lines(o.id)
          .then((res) => (Array.isArray(res) ? res : res?.lines || res?.data || []))
          .catch(() => [])
      )
    );
    const flat = perOrder.flat();
    const normalized = flat.map((l) => ({
      order_id:     l.order_id     || null,
      line_num:     l.line_num     || null,
      item_id:      l.item_id      || null,
      description:  l.description  || "",
      qty_ordered:  l.qty_ordered  || 0,
      unit_weight:  l.unit_weight  || l.unit_value  || 0,
      total_weight: l.total_weight || l.total_value || 0,
    }));
    // Match the SQL backfill's ORDER BY (order_id, line_num).
    normalized.sort((a, b) => {
      const aOrd = String(a.order_id || "");
      const bOrd = String(b.order_id || "");
      if (aOrd !== bOrd) return aOrd < bOrd ? -1 : 1;
      return Number(a.line_num || 0) - Number(b.line_num || 0);
    });
    return normalized;
  } catch (_) {
    return [];
  }
}

/**
 * Compute the source shipment's transit window in days. Used by
 * copyShipment to project the same window onto the copy's new pickup
 * date so the Transit Days InfoBox keeps rendering a real value
 * instead of "—".
 */
function transitDaysFromShipment(s) {
  if (!s || !s.pickup_date || !s.delivery_date) return null;
  const d1 = new Date(s.pickup_date);
  const d2 = new Date(s.delivery_date);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return null;
  const days = Math.round((d2 - d1) / 86_400_000);
  return days > 0 ? days : null;
}

/**
 * Copy an existing shipment with a new ID and reset status.
 * @param {Object} sourceShipment - The shipment to copy.
 * @returns {Object} The newly created copy.
 */
export async function copyShipment(sourceShipment) {
  const id = generateShipmentId();
  const today = new Date().toISOString().slice(0, 10);
  const s = sourceShipment || {};

  // Project the source's transit window forward onto today's pickup so
  // the Transit Days InfoBox stays populated on the copy. Falls back to
  // NULL if the source has no usable window (modal will render "—").
  const projectedDelivery = computeDeliveryDate(today, transitDaysFromShipment(s));

  // Migration 032: snapshot the source's line items now (before the
  // shipment insert) so they ship in the same payload — the modal
  // reads `shipments.line_items` as a fallback whenever no orders are
  // linked, which is exactly the post-copy state.
  const lineItemsSnapshot = await buildLineItemsSnapshot(s._linkedOrders);

  const copy = {
    id,
    // ── Lane / location ─────────────────────────────────────────────
    origin:         s.origin || "",
    dest:           s.dest || "",
    origin_zip:     s.origin_zip || null,
    dest_zip:       s.dest_zip || null,
    ship_from_name: s.ship_from_name || null,
    ship_to_name:   s.ship_to_name || null,
    miles:          s.miles || 0,

    // ── Freight characteristics ─────────────────────────────────────
    // NOTE: `hazmat` is NOT a shipments column (lives on orders /
    // locations). Writing it here returns PGRST204.
    mode:   s.mode || "LTL",
    weight: s.weight || 0,
    pieces: s.pieces || 0,
    // Migration 031: commodity snapshot. Prefer the page-hydrated
    // `_commodity` (live aggregation from currently-linked orders) so
    // the copy reflects the freshest reality, then fall through to the
    // stored snapshot column. The copy intentionally drops order_ids,
    // so without this snapshot the modal would render "—" forever
    // even though the source had a clear commodity value.
    commodity: s._commodity || s.commodity || null,
    // Migration 032: line items snapshot. Built from the source's
    // currently-linked orders' order_lines (live read just above).
    // Falls back to the source's own snapshot column if it had one
    // and the live read returned empty (e.g. the source itself was a
    // copy with no linked orders). The modal reads this column as
    // its fallback whenever no orders are linked — see the Line
    // Items useEffect in ShipmentsPage.jsx.
    line_items: lineItemsSnapshot.length > 0
      ? lineItemsSnapshot
      : (Array.isArray(s.line_items) ? s.line_items : []),

    // ── Carrier / rate snapshot ─────────────────────────────────────
    // rate_id is preserved so the Shipment Details modal continues to
    // resolve the same rate row for derived fields (transit days,
    // equipment fallback, discount %, etc.). The carrier/cost columns
    // mirror the source so the copy lands as an exact rate-confirmed
    // duplicate ready for the planner. discount_pct / discount_amount
    // are NOT shipment columns — they live on `rates` and are derived
    // at render time via summarizeDiscount(rateRow).
    carrier:        s.carrier || "",
    service_level:  s.service_level || "Standard",
    equipment:      s.equipment ?? null,
    rate_id:        s.rate_id || null,
    total_cost:     s.total_cost || 0,
    rate:           s.rate || 0,
    fuel_surcharge: s.fuel_surcharge || 0,
    accessorials:   s.accessorials || 0,

    // ── Operational scheduling (carried forward) ────────────────────
    // Dock + loading-window fields are real shipment columns
    // (migrations 20260406_shipments_dock_fields and
    // 20260324120000_shipments_loading_times). Carrying them forward
    // gives the copy a usable starting schedule the planner can edit
    // — the alternative (blank) defeats the purpose of "copy".
    dock_door:     s.dock_door     || null,
    dock_time:     s.dock_time     || null,
    loading_start: s.loading_start || null,
    loading_end:   s.loading_end   || null,

    // ── Reset on copy ───────────────────────────────────────────────
    // Identifier-unique / carrier-assigned fields are NOT carried
    // forward: pro_number (carrier-assigned at tender), seal_number
    // (set at trailer load), order_ids (linkage), bol_type,
    // master_shipment_id, tender_*. These belong to the original
    // execution and would either violate uniqueness or be misleading.
    //
    // bol_number — auto-stamped from the new shipment id, mirroring
    // bulkPlanExecution.js (`bol_number: BOL-<shipId>`), so the
    // BOL/Carrier Ref InfoBox renders immediately on the copy
    // instead of "—".
    //
    // pickup_date resets to today; delivery_date is projected from
    // the source's transit window (or NULL if it had none — Postgres
    // `date` rejects "", SQLSTATE 22007).
    bol_number:    `BOL-${id}`,
    pickup_date:   today,
    delivery_date: projectedDelivery,
    status:        "Planned",
    notes:         s.notes || "",

    // Audit metadata (stripped before DB write by POST /api/shipments;
    // surfaces on the change_history "create" row as `copiedFrom`).
    copiedFrom: s.id || null,
  };

  await ShipmentsApi.create(copy);
  // Per product decision: the copy does NOT create new orders or
  // re-link the source's orders. The new shipment lands without
  // ASSOCIATED ORDER / LINE ITEMS until the user attaches orders
  // to it via the existing flow. (See chat history 2026-05-03 — the
  // earlier order-duplication path was reverted.)
  return copy;
}

export async function deleteShipmentById(shipmentId) {
  return ShipmentsApi.remove(shipmentId);
}

/**
 * REQ-24 — Persist ship-from / ship-to fields for a shipment.
 *
 * Takes two canonical Location objects ({name, city, state, zip}) and
 * writes the composed origin/dest strings, zip columns, and name
 * columns in a single PATCH. UI components MUST go through this
 * function — they must not call ShipmentsApi.update directly
 * (CLAUDE_RULES #3 / #4 — no API calls from components).
 *
 * Bug #38 follow-up: routes through ShipmentsApi.update so the audited
 * /api/shipments/:id path writes change_history rows and runs the OMS
 * dock mirror. `locationsToShipmentPatch` returns DB-shape (snake_case)
 * keys; the audited path normalizes them to camelCase via
 * `normalizeShipmentUpdates` in api/services/shipments.js.
 *
 * @param {string} shipmentId
 * @param {{name:string,city:string,state:string,zip:string}} fromLoc
 * @param {{name:string,city:string,state:string,zip:string}} toLoc
 */
export async function updateShipmentLocations(shipmentId, fromLoc, toLoc) {
  if (!shipmentId) throw new Error("updateShipmentLocations: shipmentId is required");
  const patch = locationsToShipmentPatch(fromLoc, toLoc);
  return ShipmentsApi.update(shipmentId, patch);
}

/**
 * Record a manual timeline event on a shipment. Backend maps the event
 * type to a shipment/order status transition where applicable (Delivered
 * flips shipment + linked orders to Delivered and stamps delivery_date;
 * Picked Up flips them to In Transit and stamps pickup_date; Exception
 * moves the shipment to Exception; etc.) and writes change_history rows
 * on both entities. UI components MUST go through this service (no
 * direct calls to ShipmentsApi from components — CLAUDE_RULES #3 / #4).
 *
 * @param {string} shipmentId
 * @param {{ type:string, note?:string, date?:string }} event
 */
/**
 * Resolve the trailer/equipment to display for a shipment.
 *
 * Migration 025 added shipments.equipment as a snapshot of the rate's
 * equipment at planning time, but rows that pre-date the migration (or
 * were planned before the planner started carrying equipment forward)
 * are NULL. The migration's own notes explicitly call out a best-effort
 * fallback: re-derive from rates.equipment via shipments.rate_id.
 *
 * Returns:
 *   { value: string|null, source: "shipment"|"rate"|null }
 *
 *   - source === "shipment" → snapshot stored on the row
 *   - source === "rate"     → derived at render time from the rate
 *   - source === null       → unknown (no shipment value, no rate match)
 *
 * UI components MUST go through this helper instead of reading
 * `shipment.equipment` directly so the fallback stays consistent across
 * every shipment view (CLAUDE_RULES #3 — services own logic).
 */
export function deriveShipmentEquipment(shipment, rateRow) {
  const stored = shipment && typeof shipment.equipment === "string"
    ? shipment.equipment.trim()
    : "";
  if (stored) return { value: stored, source: "shipment" };

  const fromRate = rateRow && typeof rateRow.equipment === "string"
    ? rateRow.equipment.trim()
    : "";
  if (fromRate) return { value: fromRate, source: "rate" };

  return { value: null, source: null };
}

export async function recordShipmentEvent(shipmentId, event) {
  if (!shipmentId) throw new Error("recordShipmentEvent: shipmentId is required");
  if (!event || !event.type) throw new Error("recordShipmentEvent: event.type is required");
  return ShipmentsApi.addEvent(shipmentId, {
    type: event.type,
    note: event.note || "",
    date: event.date || new Date().toISOString().slice(0, 10),
  });
}

/**
 * Compute a shipment delivery date from a pickup date and a transit-days
 * count. Used when a rate quote provides transitDays but no explicit
 * deliveryDate (TL quotes do not populate deliveryDate — only LTL does).
 *
 * Returns an ISO yyyy-mm-dd string, or null if the inputs are unusable.
 * Exported so the carrier-change flow and any future re-quote flow share
 * the same arithmetic instead of each hand-rolling a date math snippet.
 */
export function computeDeliveryDate(pickupDate, transitDays) {
  if (!pickupDate) return null;
  const days = Number(transitDays);
  if (!Number.isFinite(days) || days <= 0) return null;
  const d = new Date(pickupDate);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

/**
 * Change the carrier (and the rate fields that move with it) on an
 * existing shipment. Single source of truth for the shape mapping
 * between a rate-engine quote and the shipment columns the API expects.
 *
 * Rationale:
 *   - The previous flow PATCHed shipments directly from the
 *     ShipmentDetailModal component, which violated CLAUDE_RULES #3 / #4
 *     (no API calls from components, services own logic).
 *   - The raw PATCH bypassed shipService.updateShipment so no
 *     change_history rows were written for the carrier change and no
 *     SHIPMENT_UPDATED broadcast went out — which is what produced the
 *     stale-carrier display bug after a change.
 *   - Beyond the carrier itself, switching to another carrier almost
 *     always lands on a different rate row. Equipment, rate_id, and the
 *     transit window all belong to that new rate. We forward them in
 *     the same patch so the Shipment Details modal does not keep
 *     deriving "Equipment (from rate)", "Rate ID", and "Transit Days"
 *     from the previous rate.
 *
 * @param {string} shipmentId
 * @param {Object} quote      Rate-engine quote (carrier, mode, totalCharge,
 *                            rateId, equipment, transitDays, deliveryDate, …)
 * @param {Object} [current]  Current shipment row, used as the fallback
 *                            for fields the quote does not provide and
 *                            as the pickup date for transit-day math.
 * @returns {Promise<{shipment:Object, before:Object, patch:Object}>}
 */
export async function changeShipmentCarrier(shipmentId, quote, current = {}) {
  if (!shipmentId) throw new Error("changeShipmentCarrier: shipmentId is required");
  if (!quote || !quote.carrier) throw new Error("changeShipmentCarrier: quote.carrier is required");

  const payload = {
    carrier:        quote.carrier,
    mode:           quote.mode           || current.mode           || null,
    total_cost:     quote.totalCharge    != null ? quote.totalCharge : (current.total_cost || 0),
    rate:           quote.czarBaseGross  != null ? quote.czarBaseGross
                  : quote.czarBase       != null ? quote.czarBase
                  : (current.rate || 0),
    fuel_surcharge: quote.fscCharge      != null ? quote.fscCharge : (current.fuel_surcharge || 0),
    miles:          quote.miles          != null ? quote.miles : current.miles,
    service_level:  quote.serviceLevel   || current.service_level  || null,
  };
  // rate_id — switching carriers points at a different rates row. The
  // backend allow-list accepts null, but the rate engine should always
  // provide one; only forward when present so we never null-out a real
  // pointer because of an upstream omission.
  if (quote.rateId) payload.rate_id = quote.rateId;

  // Equipment is snapshotted onto the shipment row (migration 025). When
  // the quote brings equipment along, snapshot the new value so the
  // modal's deriveShipmentEquipment() returns "Equipment" (from
  // shipment) with the right trailer instead of "Equipment (from rate)"
  // pointing at the old rate. Empty / missing equipment passes through
  // as null so we never strand the column on a stale value from the
  // previous carrier.
  if (quote.equipment !== undefined) {
    const eq = typeof quote.equipment === "string" ? quote.equipment.trim() : quote.equipment;
    payload.equipment = eq || null;
  }

  // Delivery date — prefer the quote's explicit deliveryDate (LTL path
  // populates it), otherwise compute from pickup + transitDays (TL path
  // leaves deliveryDate empty). This keeps the Transit Days InfoBox in
  // the modal honest after a carrier change.
  const pickup = current.pickup_date || null;
  const explicit = (quote.deliveryDate || "").trim();
  if (explicit) {
    payload.delivery_date = explicit;
  } else {
    const computed = computeDeliveryDate(pickup, quote.transitDays);
    if (computed) payload.delivery_date = computed;
  }

  return ShipmentsApi.changeCarrier(shipmentId, payload);
}
