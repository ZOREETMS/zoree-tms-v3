/**
 * Dock-related constants — shared across dock scheduling, planning, and shipment components.
 */

export const DOCK_DOORS = ["Door 1", "Door 2", "Door 3", "Door 4", "Door 5", "Door 6"];

/** Scheduling grid hours (06:00 – 20:00) */
export const DOCK_HOURS = Array.from({ length: 15 }, (_, i) => {
  const h = i + 6;
  return `${String(h).padStart(2, "0")}:00`;
});

/** Default loading durations by mode (minutes) */
export const LOAD_DURATION_BY_MODE = {
  TL: 120,
  LTL: 90,
  Partial: 90,
  Air: 60,
};

/** Default start hour for dock windows */
export const DEFAULT_DOCK_START = "06:00";

/** Available loading duration options (minutes) */
export const LOAD_DURATION_OPTIONS = [60, 90, 120, 150, 180];

/**
 * Per-warehouse dock configuration.
 * Key = uppercase origin string.
 * Value = { doors: string[], maxPerDoor: number, maxHoursPerDoor: number }.
 * Warehouses not listed here fall back to the global DOCK_DOORS with no limits.
 */
export const WAREHOUSE_DOCK_CONFIG = {
  "ATLANTA, GA 30350": { doors: ["Door 1", "Door 2"], maxPerDoor: 2, maxHoursPerDoor: 4, startHour: 6, endHour: 10 },
};

/**
 * Get dock configuration for a specific warehouse origin.
 * @param {string} origin - Warehouse origin (e.g. "ATLANTA, GA 30350")
 * @returns {{ doors: string[], maxPerDoor: number, maxHoursPerDoor: number }}
 */
export function getWarehouseDockConfig(origin) {
  const key = (origin || "").toUpperCase();
  const config = WAREHOUSE_DOCK_CONFIG[key];
  return config || { doors: DOCK_DOORS, maxPerDoor: Infinity, maxHoursPerDoor: Infinity, startHour: 6, endHour: 20 };
}

/** Appointment type → background color mapping */
export const APPT_TYPE_COLORS = {
  Inbound:     "#3b82f6",
  Outbound:    "#16a34a",
  "Cross-Dock": "#7c3aed",
  Conflict:    "#dc2626",
  Blocked:     "#94a3b8",
};

/** Appointment type options */
export const APPT_TYPES = ["Outbound", "Inbound", "Cross-Dock"];

/** Appointment status options */
export const APPT_STATUSES = ["Scheduled", "Confirmed", "In Progress", "Completed", "Cancelled"];

/** Duration options for appointment editor (value → label) */
export const DURATION_OPTIONS = [
  { value: 30,  label: "30 MIN" },
  { value: 60,  label: "1 HOUR" },
  { value: 90,  label: "90 MIN" },
  { value: 120, label: "2 HOURS" },
  { value: 150, label: "150 MIN" },
  { value: 180, label: "3 HOURS" },
];
