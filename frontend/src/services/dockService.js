/**
 * Dock Service — handles dock door assignment logic during planning.
 *
 * Responsible for:
 *   - Assigning dock doors to shipment plans (single or bulk)
 *   - Calculating loading time windows based on mode and duration
 *   - Round-robin door allocation grouped by pickup date + origin
 */

import { DOCK_DOORS, LOAD_DURATION_BY_MODE, DEFAULT_DOCK_START } from "../constants/docks";
import { getDockConfigForWarehouse } from "./dockScheduleService";

/**
 * Extract just the "HH:mm" time portion from a value that may be:
 *   - "2026-04-07 06:00"  (datetime string)
 *   - "06:00"             (time-only)
 *   - null / undefined
 * @param {string|null} value
 * @returns {string|null} "HH:mm" or null
 */
export function extractTime(value) {
  if (!value) return null;
  return value.includes(" ") ? value.split(" ")[1] : value;
}

/**
 * Parse a shipment's dock fields into a normalized { start, duration } object.
 * Handles all persisted formats: loading_start/end datetimes, dock_time ranges.
 *
 * @param {object} shipment   - row with loading_start, loading_end, dock_time
 * @param {number} [fallbackIndex=0] - index for staggered fallback start
 * @returns {{ start: string, duration: number }}
 */
export function parseLoadingWindow(shipment, fallbackIndex = 0) {
  const DEFAULT_DURATION = 90;
  const fallbackStart = `${String(8 + fallbackIndex).padStart(2, "0")}:00`;

  let start = fallbackStart;
  let duration = DEFAULT_DURATION;

  // Prefer loading_start/end (precise)
  if (shipment.loading_start) {
    start = extractTime(shipment.loading_start) || start;
  } else if (shipment.dock_time) {
    // dock_time uses en-dash (–) or hyphen (-)
    start = shipment.dock_time.split("–")[0] || shipment.dock_time.split("-")[0] || start;
  }

  // Compute duration from start/end if both available
  if (shipment.loading_start && shipment.loading_end) {
    const sTime = extractTime(shipment.loading_start) || "0:0";
    const eTime = extractTime(shipment.loading_end) || "0:0";
    const [sh, sm] = sTime.split(":").map(Number);
    const [eh, em] = eTime.split(":").map(Number);
    const mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins > 0) duration = mins;
  }

  return { start, duration };
}

/**
 * Calculate the end time given a start time and duration in minutes.
 * @param {string} startTime - "HH:mm" format
 * @param {number} durationMin - duration in minutes
 * @returns {string} end time in "HH:mm" format
 */
export function calcEndTime(startTime, durationMin) {
  const [h, m] = startTime.split(":").map(Number);
  const endTotal = h * 60 + (m || 0) + durationMin;
  return `${String(Math.floor(endTotal / 60)).padStart(2, "0")}:${String(endTotal % 60).padStart(2, "0")}`;
}

/**
 * Build dock assignment fields for a single plan.
 * @param {object} opts
 * @param {string} opts.door       - Door name (e.g. "Door 1")
 * @param {string} opts.startTime  - "HH:mm" start
 * @param {number} opts.duration   - minutes
 * @param {string} [opts.pickupDate] - ISO date for the shipment pickup
 * @returns {object} { dockDoor, dockTime, loadingStart, loadingEnd }
 */
export function buildDockFields({ door, startTime, duration, pickupDate }) {
  const endTime = calcEndTime(startTime, duration);
  return {
    dockDoor: door,
    dockTime: `${startTime}\u2013${endTime}`,
    loadingStart: pickupDate ? `${pickupDate} ${startTime}` : startTime,
    loadingEnd: pickupDate ? `${pickupDate} ${endTime}` : endTime,
  };
}

/**
 * Assign dock fields to a single plan from the plan confirmation modal.
 * Used when user manually confirms a plan with dock reservation enabled.
 *
 * @param {object} plan           - The plan object to augment (mutated in place)
 * @param {object} opts
 * @param {string} [opts.dockDoor]     - Selected door (default: "Door 1")
 * @param {string} [opts.startTime]    - Selected start time (default: "06:00")
 * @param {number} [opts.loadDuration] - Minutes (default: mode-based)
 * @param {number} [opts.groupIndex]   - Index within multi-group (for round-robin)
 * @param {number} [opts.groupCount]   - Total groups (1 = single, >1 = multi)
 */
export function assignDockToPlan(plan, { dockDoor, startTime, loadDuration, groupIndex = 0, groupCount = 1, existingShipments = [], dockConfigs = [] } = {}) {
  const mode = (plan.mode || "TL").toUpperCase();
  const warehouseDoors = getDockConfigForWarehouse(dockConfigs, plan.origin).doors;
  const dur = loadDuration || LOAD_DURATION_BY_MODE[mode] || 120;

  // If user explicitly chose a door, use it; otherwise auto-assign
  let door;
  let start;
  if (dockDoor) {
    door = dockDoor;
    // Check if the chosen start time conflicts with existing appointments
    const occupancy = buildDoorOccupancy(existingShipments);
    const doorKey = `${plan.pickupDate || ""}|${(plan.origin || "").toLowerCase().trim()}|${door}`;
    const occupiedMins = occupancy[doorKey] || 0;
    const requestedStart = startTime || DEFAULT_DOCK_START;
    const [rh, rm] = requestedStart.split(":").map(Number);
    const requestedOffset = (rh - 6) * 60 + (rm || 0);
    // If requested slot overlaps, push to next available
    if (requestedOffset < occupiedMins) {
      const h = 6 + Math.floor(occupiedMins / 60);
      const m = occupiedMins % 60;
      start = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    } else {
      start = requestedStart;
    }
  } else {
    // Auto-assign: find the door with the least occupied time
    const occupancy = buildDoorOccupancy(existingShipments);
    const keyPrefix = `${plan.pickupDate || ""}|${(plan.origin || "").toLowerCase().trim()}`;
    let bestDoor = groupCount === 1 ? warehouseDoors[0] : warehouseDoors[groupIndex % warehouseDoors.length];
    let bestMins = Infinity;
    for (const d of warehouseDoors) {
      const dk = `${keyPrefix}|${d}`;
      const occupied = occupancy[dk] || 0;
      if (occupied < bestMins) { bestMins = occupied; bestDoor = d; }
    }
    door = bestDoor;
    const doorKey = `${keyPrefix}|${door}`;
    const occupiedMins = occupancy[doorKey] || 0;
    const h = 6 + Math.floor(occupiedMins / 60);
    const m = occupiedMins % 60;
    start = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  // Check if assignment exceeds warehouse operating window
  const whConfig = getDockConfigForWarehouse(dockConfigs, plan.origin);
  const [sh, sm] = start.split(":").map(Number);
  const endMinFromStart = (sh * 60 + sm) + dur;
  const maxMin = whConfig.endHour * 60;
  if (endMinFromStart > maxMin) {
    plan.dockIssue = `No dock capacity on ${plan.pickupDate} at ${plan.origin} (all doors full)`;
    return;
  }

  const fields = buildDockFields({ door, startTime: start, duration: dur, pickupDate: plan.pickupDate });
  Object.assign(plan, fields);
}

/**
 * Build a map of occupied minutes per door from existing shipments.
 * Used to avoid double-booking when assigning new dock slots.
 *
 * @param {object[]} shipments - Existing shipments with dock fields
 * @returns {object} Map of "pickupDate|origin|door" → total occupied minutes from 06:00
 */
function buildDoorOccupancy(shipments) {
  const doorMinutes = {};
  for (const s of shipments) {
    if (!s.pickup_date || !s.dock_door || s.status === "Cancelled") continue;
    const key = `${s.pickup_date}|${(s.origin || "").toLowerCase().trim()}|${s.dock_door}`;
    const { duration } = parseLoadingWindow(s);
    doorMinutes[key] = (doorMinutes[key] || 0) + (duration || 90);
  }
  return doorMinutes;
}

/**
 * Auto-assign dock doors to an array of plans for bulk planning.
 * Groups plans by pickup date + origin and assigns doors round-robin.
 * Start times are staggered per door to avoid conflicts with existing shipments.
 *
 * @param {object[]} plans - Array of plan objects (mutated in place)
 * @param {object[]} [existingShipments=[]] - Already-persisted shipments to avoid overlaps
 */
export function assignDocksToPlans(plans, existingShipments = [], dockConfigs = []) {
  const counters = {};    // key: "pickupDate|origin" → next door index
  const doorMinutes = buildDoorOccupancy(existingShipments);

  for (const plan of plans) {
    const key = `${plan.pickupDate || ""}|${(plan.origin || "").toLowerCase().trim()}`;
    if (!counters[key]) counters[key] = 0;

    const warehouseDoors = getDockConfigForWarehouse(dockConfigs, plan.origin).doors;
    const mode = (plan.mode || "TL").toUpperCase();
    const dur = LOAD_DURATION_BY_MODE[mode] || 120;

    // Find the door with the least occupied time (best-fit instead of blind round-robin)
    let bestDoor = warehouseDoors[0];
    let bestMins = Infinity;
    for (const d of warehouseDoors) {
      const dk = `${key}|${d}`;
      const occupied = doorMinutes[dk] || 0;
      if (occupied < bestMins) { bestMins = occupied; bestDoor = d; }
    }

    const whConfig = getDockConfigForWarehouse(dockConfigs, plan.origin);
    const doorKey = `${key}|${bestDoor}`;
    if (!doorMinutes[doorKey]) doorMinutes[doorKey] = 0;
    const offsetMins = doorMinutes[doorKey];
    const maxMins = (whConfig.endHour - whConfig.startHour) * 60;

    // Check if this appointment would exceed the warehouse operating window
    if (offsetMins + dur > maxMins) {
      // Dock capacity exceeded — flag as issue, skip dock assignment
      plan.dockIssue = `No dock capacity on ${plan.pickupDate} at ${plan.origin} (all doors full)`;
      counters[key]++;
      continue;
    }

    const startH = whConfig.startHour + Math.floor(offsetMins / 60);
    const startM = offsetMins % 60;
    const startTime = `${String(startH).padStart(2, "0")}:${String(startM).padStart(2, "0")}`;

    const fields = buildDockFields({
      door: bestDoor,
      startTime,
      duration: dur,
      pickupDate: plan.pickupDate,
    });
    Object.assign(plan, fields);

    doorMinutes[doorKey] += dur;
    counters[key]++;
  }
}
