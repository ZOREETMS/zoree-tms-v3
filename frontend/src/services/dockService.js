/**
 * Dock Service — handles dock door assignment logic during planning.
 *
 * Responsible for:
 *   - Assigning dock doors to shipment plans (single or bulk)
 *   - Calculating loading time windows based on mode and duration
 *   - Round-robin door allocation grouped by pickup date + origin
 */

import { DOCK_DOORS, LOAD_DURATION_BY_MODE, DEFAULT_DOCK_START } from "../constants/docks";

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
export function assignDockToPlan(plan, { dockDoor, startTime, loadDuration, groupIndex = 0, groupCount = 1 } = {}) {
  const mode = (plan.mode || "TL").toUpperCase();
  const door = groupCount === 1
    ? (dockDoor || DOCK_DOORS[0])
    : DOCK_DOORS[groupIndex % DOCK_DOORS.length];
  const start = startTime || DEFAULT_DOCK_START;
  const dur = loadDuration || LOAD_DURATION_BY_MODE[mode] || 120;

  const fields = buildDockFields({ door, startTime: start, duration: dur, pickupDate: plan.pickupDate });
  Object.assign(plan, fields);
}

/**
 * Auto-assign dock doors to an array of plans for bulk planning.
 * Groups plans by pickup date + origin and assigns doors round-robin.
 * Start times are staggered per door to avoid conflicts.
 *
 * @param {object[]} plans - Array of plan objects (mutated in place)
 */
export function assignDocksToPlans(plans) {
  const counters = {}; // key: "pickupDate|origin" → next door index

  for (const plan of plans) {
    const key = `${plan.pickupDate || ""}|${(plan.origin || "").toLowerCase().trim()}`;
    if (!counters[key]) counters[key] = 0;

    const doorIdx = counters[key] % DOCK_DOORS.length;
    const mode = (plan.mode || "TL").toUpperCase();
    const dur = LOAD_DURATION_BY_MODE[mode] || 120;
    const startH = 6 + doorIdx; // stagger: 06:00, 07:00, 08:00, ...
    const startTime = `${String(startH).padStart(2, "0")}:00`;

    const fields = buildDockFields({
      door: DOCK_DOORS[doorIdx],
      startTime,
      duration: dur,
      pickupDate: plan.pickupDate,
    });
    Object.assign(plan, fields);

    counters[key]++;
  }
}
