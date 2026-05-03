import { DbApi, ShipmentsApi } from "../lib/api";
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
    status: "Planned",
  };
  // Routed through the dedicated endpoint so the backend records a
  // 'create' change_history row — the Shipment Details timeline reads
  // this to render the "Order Created & Rate Confirmed" timestamp.
  await ShipmentsApi.create(shipment);
  return shipment;
}

/**
 * Copy an existing shipment with a new ID and reset status.
 * @param {Object} sourceShipment - The shipment to copy.
 * @returns {Object} The newly created copy.
 */
export async function copyShipment(sourceShipment) {
  const id = generateShipmentId();
  const today = new Date().toISOString().slice(0, 10);

  const copy = {
    id,
    origin: sourceShipment.origin || "",
    dest: sourceShipment.dest || "",
    mode: sourceShipment.mode || "LTL",
    carrier: sourceShipment.carrier || "",
    weight: sourceShipment.weight || 0,
    pieces: sourceShipment.pieces || 0,
    total_cost: sourceShipment.total_cost || 0,
    miles: sourceShipment.miles || 0,
    rate: sourceShipment.rate || 0,
    fuel_surcharge: sourceShipment.fuel_surcharge || 0,
    service_level: sourceShipment.service_level || "Standard",
    equipment: sourceShipment.equipment ?? null,
    notes: sourceShipment.notes || "",
    pickup_date: today,
    delivery_date: "",
    status: "Planned",
    // Do not copy: order_ids, bol_type, master_shipment_id, tender fields
    copiedFrom: sourceShipment.id || null,
  };

  await ShipmentsApi.create(copy);
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
 * function — they must not call DbApi.patch("shipments", ...) directly
 * (CLAUDE_RULES #3 / #4 — no API calls from components).
 *
 * @param {string} shipmentId
 * @param {{name:string,city:string,state:string,zip:string}} fromLoc
 * @param {{name:string,city:string,state:string,zip:string}} toLoc
 */
export async function updateShipmentLocations(shipmentId, fromLoc, toLoc) {
  if (!shipmentId) throw new Error("updateShipmentLocations: shipmentId is required");
  const patch = locationsToShipmentPatch(fromLoc, toLoc);
  return DbApi.patch("shipments", shipmentId, patch);
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
