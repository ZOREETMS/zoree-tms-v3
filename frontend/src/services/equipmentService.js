import { DbApi } from "../lib/api";

const TABLE = "equipment_types";

const SEED_EQUIPMENT = [
  { id: "EQ-001", name: "Dry Van 53ft", code: "DV53", description: "Standard 53ft dry van trailer", max_weight: 45000, max_volume: 3800, length: 53, width: 8.5, height: 9, temp_controlled: false, hazmat_certified: false, status: "Active" },
  { id: "EQ-002", name: "Dry Van 48ft", code: "DV48", description: "Standard 48ft dry van trailer", max_weight: 44000, max_volume: 3400, length: 48, width: 8.5, height: 9, temp_controlled: false, hazmat_certified: false, status: "Active" },
  { id: "EQ-003", name: "Reefer 53ft", code: "RF53", description: "53ft refrigerated trailer", max_weight: 43000, max_volume: 3600, length: 53, width: 8.5, height: 9, temp_controlled: true, hazmat_certified: false, status: "Active" },
  { id: "EQ-004", name: "Reefer 48ft", code: "RF48", description: "48ft refrigerated trailer", max_weight: 42000, max_volume: 3200, length: 48, width: 8.5, height: 9, temp_controlled: true, hazmat_certified: false, status: "Active" },
  { id: "EQ-005", name: "Flatbed 53ft", code: "FB53", description: "53ft flatbed trailer", max_weight: 48000, max_volume: 0, length: 53, width: 8.5, height: 0, temp_controlled: false, hazmat_certified: false, status: "Active" },
  { id: "EQ-006", name: "Flatbed 48ft", code: "FB48", description: "48ft flatbed trailer", max_weight: 47000, max_volume: 0, length: 48, width: 8.5, height: 0, temp_controlled: false, hazmat_certified: false, status: "Active" },
  { id: "EQ-007", name: "LTL", code: "LTL", description: "Less-than-truckload shared trailer", max_weight: 20000, max_volume: 2000, length: 53, width: 8.5, height: 9, temp_controlled: false, hazmat_certified: false, status: "Active" },
  { id: "EQ-008", name: "Step Deck", code: "SD48", description: "48ft step deck trailer", max_weight: 43000, max_volume: 0, length: 48, width: 8.5, height: 10, temp_controlled: false, hazmat_certified: false, status: "Active" },
  { id: "EQ-009", name: "Tanker", code: "TANK", description: "Liquid bulk tanker trailer", max_weight: 45000, max_volume: 6800, length: 42, width: 8, height: 0, temp_controlled: false, hazmat_certified: true, status: "Active" },
  { id: "EQ-010", name: "Intermodal Container 40ft", code: "IM40", description: "40ft intermodal shipping container", max_weight: 44800, max_volume: 2350, length: 40, width: 8, height: 8.5, temp_controlled: false, hazmat_certified: false, status: "Active" },
  { id: "EQ-011", name: "Sprinter Van", code: "SPRN", description: "Sprinter/cargo van for small shipments", max_weight: 3500, max_volume: 400, length: 12, width: 6, height: 6, temp_controlled: false, hazmat_certified: false, status: "Active" },
  { id: "EQ-012", name: "Straight Truck 26ft", code: "ST26", description: "26ft box truck / straight truck", max_weight: 10000, max_volume: 1500, length: 26, width: 8, height: 8, temp_controlled: false, hazmat_certified: false, status: "Active" },
];

/** Returns equipment list — falls back to seed data when DB table is empty or missing */
export function getEquipmentList(equipmentTypes) {
  return equipmentTypes && equipmentTypes.length > 0 ? equipmentTypes : SEED_EQUIPMENT;
}

/** Prepare payload with parsed numeric fields and auto-generated ID */
function buildPayload(item) {
  return {
    ...item,
    id: item.id || `EQ-${Date.now().toString(36).toUpperCase()}`,
    max_weight: parseFloat(item.max_weight) || 0,
    max_volume: parseFloat(item.max_volume) || 0,
    length: parseFloat(item.length) || 0,
    width: parseFloat(item.width) || 0,
    height: parseFloat(item.height) || 0,
  };
}

/** Save (create or update) an equipment type */
export async function saveEquipmentRecord(item) {
  const payload = buildPayload(item);
  return DbApi.upsert(TABLE, payload);
}

/** Soft-delete: set status to Inactive */
export async function deactivateEquipment(id) {
  return DbApi.patch(TABLE, id, { status: "Inactive" });
}

/** Compute summary stats from equipment list */
export function computeEquipmentStats(list) {
  return {
    total: list.length,
    active: list.filter((e) => e.status === "Active").length,
    tempControlled: list.filter((e) => e.temp_controlled).length,
    hazmat: list.filter((e) => e.hazmat_certified).length,
  };
}

/** Empty form template for creating new equipment */
export const EMPTY_EQUIPMENT = {
  id: "", name: "", code: "", description: "",
  max_weight: "", max_volume: "",
  length: "", width: "", height: "",
  temp_controlled: false, hazmat_certified: false,
  status: "Active",
};
