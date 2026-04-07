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
