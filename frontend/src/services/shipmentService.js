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
  const shipment = {
    id,
    ...shipmentData,
    weight: parseFloat(shipmentData.weight) || 0,
    pieces: parseInt(shipmentData.pieces) || 0,
    total_cost: parseFloat(shipmentData.total_cost) || 0,
    status: "Planned",
  };
  await DbApi.upsert("shipments", shipment);
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
    notes: sourceShipment.notes || "",
    pickup_date: today,
    delivery_date: "",
    status: "Planned",
    // Do not copy: order_ids, bol_type, master_shipment_id, tender fields
  };

  await DbApi.upsert("shipments", copy);
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
