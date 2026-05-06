/**
 * Order-related constants — shared across order components and services.
 */

export const STATUS_BADGES = {
  Unplanned: "badge badge-amber",
  Planned: "badge badge-teal",
  Consolidated: "badge badge-blue",
  Tendered: "badge badge-purple",
  // REQ-13: mirror the shipment's tender-accepted state on the order row.
  "Tender Accepted": "badge badge-green",
  // REQ-23: orders mirror the shipment's warehouse departure.
  Shipped: "badge badge-blue",
  "In Transit": "badge badge-blue",
  Delivered: "badge badge-green",
  "On Hold": "badge badge-amber",
  Cancelled: "badge badge-red",
  "Planning Failed": "badge badge-red",
};

// Canonical order status list — single source of truth for status dropdowns.
// Ordering reflects the lifecycle (pre-plan → in-flight → terminal).
export const ORDER_STATUSES = [
  "Unplanned",
  "Planned",
  "Consolidated",
  "Tendered",
  "Tender Accepted",
  "Shipped",
  "In Transit",
  "Delivered",
  "On Hold",
  "Planning Failed",
  "Cancelled",
];

export const STATUS_ROW_COLORS = {
  Unplanned:    { bg: "#fffef0", border: "#ca8a04" },
  Planned:      { bg: "#f0fdf4", border: "#16a34a" },
  Consolidated: { bg: "#eff6ff", border: "#2563eb" },
  Tendered:     { bg: "#fffbeb", border: "#d97706" },
  "Tender Accepted": { bg: "#ecfdf5", border: "#059669" },
  Shipped:      { bg: "#eff6ff", border: "#1d4ed8" },
  "In Transit": { bg: "#f0f9ff", border: "#0284c7" },
  Delivered:    { bg: "#f0fdf4", border: "#059669" },
  Exception:        { bg: "#fef2f2", border: "#dc2626" },
  "Planning Failed": { bg: "#fef2f2", border: "#dc2626" },
  Cancelled:        { bg: "#f9fafb", border: "#9ca3af" },
};

export const SPOT_ROW_STYLE = { background: "#fef2f2", borderLeft: "3px solid #dc2626" };

// Display-only metadata for equipment dropdowns and badges.
// `maxWeight` numbers were removed from this map on 2026-05-05 — the planner's
// LTL/TL gates now read equipment_types.max_weight via equipmentLimitsService.
// Anything that needs a real ceiling MUST go through useEquipmentLimits() or
// fetchEquipmentLimits(); icons/labels here are for UI presentation only.
export const EQUIPMENT_TYPES = {
  "Dry Van 53'":    { icon: "🚛" },
  "Flatbed":        { icon: "🏗️" },
  "Reefer 53'":     { icon: "❄️" },
  "Step Deck":      { icon: "📦" },
  "Lowboy":         { icon: "⚙️" },
  "Tanker":         { icon: "🛢️" },
  "LTL Truck":      { icon: "📬" },
  "Intermodal 53'": { icon: "🚂" },
};

export const DEFAULT_EQUIP = "Dry Van 53'";
// LTL_MAX_WEIGHT / TL_MAX_WEIGHT removed — see equipmentLimitsService.js.
export const DEMO_USERS = ["Sridhar (Dispatcher)", "Tulasi (Admin)", "System (Auto)"];
