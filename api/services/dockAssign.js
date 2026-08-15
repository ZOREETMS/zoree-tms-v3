// ═══════════════════════════════════════════════════════════════════
// Dock assignment — server-side twin of the frontend auto-assign path.
//
// Why this exists: TMS bug #64 taught us that any planner that skips
// dock assignment produces shipments with empty dock_door / dock_time /
// loading_start / loading_end ("half-empty" Shipment Details). The web
// flow fixed that client-side via frontend/src/services/dockService.js
// (assignDockToPlan). Server-side planners — the Teams bot today, the
// back-office agents next — can't import a frontend module, so this is
// a dependency-free port of the AUTO-ASSIGN branch only (no manual
// door choice, no user-facing conflict prompt: callers here are bots).
//
// Keep in sync with frontend/src/services/dockService.js +
// dockScheduleService.js + constants/docks.js if the web planner's
// dock semantics ever change (same drift warning as the date-math
// mirror in teamsBot/handlers.js).
//
// Pure module: all data (existing shipments, warehouse_dock_config
// rows, dock_loading_durations rows) is passed in by the caller.
// ═══════════════════════════════════════════════════════════════════

'use strict';

// Mirrors frontend/src/constants/docks.js
const DOCK_DOORS = ['Door 1', 'Door 2', 'Door 3', 'Door 4', 'Door 5', 'Door 6'];
const LOAD_DURATION_BY_MODE = { TL: 120, LTL: 90, PARCEL: 90, AIR: 60 };
const DEFAULT_CONFIG = { startHour: 6, endHour: 20 };

// ── small helpers (ports of dockService.js) ────────────────────────

/** "2026-04-07 06:00" | "06:00" | null → "HH:mm" | null */
function extractTime(value) {
  if (!value) return null;
  return String(value).includes(' ') ? String(value).split(' ')[1] : String(value);
}

/** "HH:mm" + minutes → "HH:mm" */
function calcEndTime(startTime, durationMin) {
  const [h, m] = startTime.split(':').map(Number);
  const endTotal = h * 60 + (m || 0) + durationMin;
  return `${String(Math.floor(endTotal / 60)).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}`;
}

/** mode → minutes, honoring enabled dock_loading_durations rows */
function getLoadDuration(mode, durationRows) {
  const key = String(mode || '').toUpperCase().trim();
  const cache = { ...LOAD_DURATION_BY_MODE };
  for (const r of Array.isArray(durationRows) ? durationRows : []) {
    if (r && r.enabled !== false && Number(r.duration_minutes) > 0) {
      cache[String(r.mode || '').toUpperCase().trim()] = Number(r.duration_minutes);
    }
  }
  return cache[key] || cache.TL || 120;
}

/** warehouse_dock_config row lookup by origin, with global fallback */
function getDockConfigForWarehouse(configRows, origin) {
  const key = (origin || '').toUpperCase();
  const row = (configRows || []).find((c) => c && c.warehouse === key);
  if (row) {
    const n = row.num_doors || 6;
    return {
      doors: Array.from({ length: n }, (_, i) => `Door ${i + 1}`),
      startHour: row.start_hour ?? DEFAULT_CONFIG.startHour,
      endHour: row.end_hour ?? DEFAULT_CONFIG.endHour,
    };
  }
  return { doors: DOCK_DOORS, startHour: DEFAULT_CONFIG.startHour, endHour: DEFAULT_CONFIG.endHour };
}

/** shipment row → { duration } from its persisted loading window */
function parseLoadingWindowDuration(shipment) {
  const DEFAULT_DURATION = 90;
  if (shipment.loading_start && shipment.loading_end) {
    const sTime = extractTime(shipment.loading_start) || '0:0';
    const eTime = extractTime(shipment.loading_end) || '0:0';
    const [sh, sm] = sTime.split(':').map(Number);
    const [eh, em] = eTime.split(':').map(Number);
    const mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins > 0) return mins;
  }
  return DEFAULT_DURATION;
}

/**
 * Map of "pickupDate|origin|door" → occupied minutes from startHour.
 * Accepts raw snake_case shipment rows (GET /api/shipments shape).
 */
function buildDoorOccupancy(shipments) {
  const doorMinutes = {};
  for (const s of Array.isArray(shipments) ? shipments : []) {
    if (!s || !s.pickup_date || !s.dock_door || s.status === 'Cancelled') continue;
    const key = `${s.pickup_date}|${(s.origin || '').toLowerCase().trim()}|${s.dock_door}`;
    doorMinutes[key] = (doorMinutes[key] || 0) + parseLoadingWindowDuration(s);
  }
  return doorMinutes;
}

/** door + start + duration (+ pickupDate) → the four dock fields */
function buildDockFields({ door, startTime, duration, pickupDate }) {
  const endTime = calcEndTime(startTime, duration);
  return {
    dockDoor: door,
    dockTime: `${startTime}–${endTime}`, // en-dash, matches web
    loadingStart: pickupDate ? `${pickupDate} ${startTime}` : startTime,
    loadingEnd: pickupDate ? `${pickupDate} ${endTime}` : endTime,
  };
}

// ── main entry ─────────────────────────────────────────────────────

/**
 * Auto-assign a dock door + loading window to a bulk-plan `plan`
 * object (mutated in place, same contract as the frontend twin).
 * Picks the least-occupied door for the pickup date + origin and
 * starts the window right after that door's existing bookings.
 *
 * Sets plan.dockIssue (and leaves dock fields absent) when the
 * warehouse operating window is full — bulkPlanExecution already
 * persists dock_issue, so the card/UI can surface it.
 *
 * @param {object} plan - bulk-plan plan ({ mode, origin, pickupDate, … })
 * @param {object} data
 * @param {object[]} [data.existingShipments] - raw rows from GET /api/shipments
 * @param {object[]} [data.dockConfigs]       - warehouse_dock_config rows
 * @param {object[]} [data.durations]         - dock_loading_durations rows
 * @returns {object} the same plan
 */
function assignDockToPlan(plan, { existingShipments = [], dockConfigs = [], durations = [] } = {}) {
  const whConfig = getDockConfigForWarehouse(dockConfigs, plan.origin);
  const dur = getLoadDuration(plan.mode || 'TL', durations);

  const occupancy = buildDoorOccupancy(existingShipments);
  const keyPrefix = `${plan.pickupDate || ''}|${(plan.origin || '').toLowerCase().trim()}`;

  // Least-occupied door (best-fit, mirrors dockService.assignDockToPlan)
  let bestDoor = whConfig.doors[0];
  let bestMins = Infinity;
  for (const d of whConfig.doors) {
    const occupied = occupancy[`${keyPrefix}|${d}`] || 0;
    if (occupied < bestMins) { bestMins = occupied; bestDoor = d; }
  }

  const occupiedMins = occupancy[`${keyPrefix}|${bestDoor}`] || 0;
  const startH = whConfig.startHour + Math.floor(occupiedMins / 60);
  const startM = occupiedMins % 60;
  const start = `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`;

  // Operating-window guard (same rule as the web planner)
  const endMinFromStart = (startH * 60 + startM) + dur;
  if (endMinFromStart > whConfig.endHour * 60) {
    plan.dockIssue = `No dock capacity on ${plan.pickupDate} at ${plan.origin} (all doors full)`;
    return plan;
  }

  Object.assign(plan, buildDockFields({
    door: bestDoor,
    startTime: start,
    duration: dur,
    pickupDate: plan.pickupDate,
  }));
  return plan;
}

module.exports = {
  assignDockToPlan,
  // exported for reuse/tests
  buildDockFields,
  buildDoorOccupancy,
  getLoadDuration,
  getDockConfigForWarehouse,
  calcEndTime,
};
