import { DbApi } from "../lib/api";

const TABLE = "equipment_types";

/** Equipment types on file (Equipment Master). No sample rows. */
export function getEquipmentList(equipmentTypes) {
  return Array.isArray(equipmentTypes) ? equipmentTypes : [];
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
