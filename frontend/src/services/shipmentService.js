import { DbApi } from "../lib/api";

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
  return {
    origin: "",
    dest: "",
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
