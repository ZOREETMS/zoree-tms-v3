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
  Parcel: 90,
  Air: 60,
};

/** Default start hour for dock windows */
export const DEFAULT_DOCK_START = "06:00";

/** Available loading duration options (minutes) */
export const LOAD_DURATION_OPTIONS = [60, 90, 120, 150, 180];

/** Default dock config for warehouses without a custom configuration */
export const DEFAULT_DOCK_CONFIG = {
  doors: DOCK_DOORS,
  maxPerDoor: Infinity,
  maxHoursPerDoor: Infinity,
  startHour: 6,
  endHour: 20,
};

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
