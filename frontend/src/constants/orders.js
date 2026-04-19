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
  Cancelled: "badge badge-red",
  "Planning Failed": "badge badge-red",
};

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

export const EQUIPMENT_TYPES = {
  "Dry Van 53'":    { maxWeight: 44000, icon: "🚛" },
  "Flatbed":        { maxWeight: 48000, icon: "🏗️" },
  "Reefer 53'":     { maxWeight: 43500, icon: "❄️" },
  "Step Deck":      { maxWeight: 48000, icon: "📦" },
  "Lowboy":         { maxWeight: 80000, icon: "⚙️" },
  "Tanker":         { maxWeight: 46000, icon: "🛢️" },
  "LTL Truck":      { maxWeight: 15000, icon: "📬" },
  "Intermodal 53'": { maxWeight: 44000, icon: "🚂" },
};

export const DEFAULT_EQUIP = "Dry Van 53'";
export const LTL_MAX_WEIGHT = 15000;
export const TL_MAX_WEIGHT = 44000;
export const DEMO_USERS = ["Sridhar (Dispatcher)", "Tulasi (Admin)", "System (Auto)"];
