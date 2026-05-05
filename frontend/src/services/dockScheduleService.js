/**
 * Dock Schedule Service — manages per-warehouse dock configuration.
 * Pure service layer — no React state, no UI side-effects.
 */

import { DbApi, ShipmentsApi } from "../lib/api";
import { DOCK_DOORS } from "../constants/docks";
import { buildDockFields } from "./dockService";

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
 * Persist a dock-board appointment edit back to its underlying shipment row.
 * Without this, dock door / time changes made on the Dock Scheduling page
 * only updated local React state — the schedule board reflected the new
 * door but the shipment record (and Shipment Details, OMS Load & Ship,
 * exports) kept the old value.
 *
 * Routes through ShipmentsApi.update (PATCH /api/shipments/:id) so the
 * backend writes change_history rows and mirrors the dock window into
 * linked oms_orders via syncDockToOms (CLAUDE_RULES §3/§4 — services-first,
 * no raw DbApi.patch on shipments).
 *
 * @param {string} shipmentId   - id of the shipment whose dock to update
 * @param {object} opts
 * @param {string} opts.door       - "Door 1", "Door 6", …
 * @param {string} opts.start      - "HH:mm" loading-window start
 * @param {number} opts.duration   - minutes
 * @param {string} [opts.pickupDate] - shipment pickup date (yyyy-mm-dd)
 * @returns {Promise<object>} updated shipment row from the API
 */
export async function persistShipmentDockAssignment(shipmentId, { door, start, duration, pickupDate }) {
  if (!shipmentId) throw new Error("persistShipmentDockAssignment: shipmentId is required");
  if (!door)       throw new Error("persistShipmentDockAssignment: door is required");
  if (!start)      throw new Error("persistShipmentDockAssignment: start is required");

  const fields = buildDockFields({ door, startTime: start, duration: duration || 90, pickupDate });
  return ShipmentsApi.update(shipmentId, {
    dockDoor:     fields.dockDoor,
    dockTime:     fields.dockTime,
    loadingStart: fields.loadingStart,
    loadingEnd:   fields.loadingEnd,
  });
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
