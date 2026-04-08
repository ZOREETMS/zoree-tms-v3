/**
 * Dock Schedule Service — manages per-warehouse dock configuration.
 * Pure service layer — no React state, no UI side-effects.
 */

import { DbApi } from "../lib/api";
import { DOCK_DOORS } from "../constants/docks";

const DEFAULT_CONFIG = {
  num_doors: 6,
  max_per_door: 4,
  max_hours_per_door: 14,
  start_hour: 6,
  end_hour: 20,
};

/**
 * Fetch all warehouse dock configs from the database.
 * @returns {Promise<object[]>}
 */
export function fetchDockConfigs() {
  return DbApi.warehouseDockConfigs();
}

/**
 * Save (upsert) a dock config for a warehouse.
 * @param {object} config - { warehouse, num_doors, max_per_door, max_hours_per_door, start_hour, end_hour }
 * @returns {Promise<object>}
 */
export async function saveDockConfig(config) {
  const payload = {
    warehouse: config.warehouse.toUpperCase(),
    num_doors: config.num_doors ?? DEFAULT_CONFIG.num_doors,
    max_per_door: config.max_per_door ?? DEFAULT_CONFIG.max_per_door,
    max_hours_per_door: config.max_hours_per_door ?? DEFAULT_CONFIG.max_hours_per_door,
    start_hour: config.start_hour ?? DEFAULT_CONFIG.start_hour,
    end_hour: config.end_hour ?? DEFAULT_CONFIG.end_hour,
  };

  // Check if config already exists for this warehouse
  if (config.id) {
    return DbApi.patch("warehouse_dock_config", config.id, payload);
  }
  return DbApi.upsert("warehouse_dock_config", payload);
}

/**
 * Build a dock config object from a DB row for use by the dock grid and planning.
 * Converts num_doors integer into an array of door names.
 *
 * @param {object} row - DB row from warehouse_dock_config
 * @returns {{ doors: string[], maxPerDoor: number, maxHoursPerDoor: number, startHour: number, endHour: number }}
 */
export function buildDockConfig(row) {
  const n = row.num_doors || DEFAULT_CONFIG.num_doors;
  const doors = Array.from({ length: n }, (_, i) => `Door ${i + 1}`);
  return {
    doors,
    maxPerDoor: row.max_per_door ?? DEFAULT_CONFIG.max_per_door,
    maxHoursPerDoor: row.max_hours_per_door ?? DEFAULT_CONFIG.max_hours_per_door,
    startHour: row.start_hour ?? DEFAULT_CONFIG.start_hour,
    endHour: row.end_hour ?? DEFAULT_CONFIG.end_hour,
  };
}

/**
 * Look up dock config for a specific warehouse from an array of DB configs.
 * Falls back to global defaults if no config found.
 *
 * @param {object[]} configs - Array of warehouse_dock_config rows
 * @param {string} origin - Warehouse origin string (e.g. "ATLANTA, GA 30350")
 * @returns {{ doors: string[], maxPerDoor: number, maxHoursPerDoor: number, startHour: number, endHour: number }}
 */
export function getDockConfigForWarehouse(configs, origin) {
  const key = (origin || "").toUpperCase();
  const row = (configs || []).find((c) => c.warehouse === key);
  if (row) return buildDockConfig(row);
  return {
    doors: DOCK_DOORS,
    maxPerDoor: Infinity,
    maxHoursPerDoor: Infinity,
    startHour: 6,
    endHour: 20,
  };
}
