// ═══════════════════════════════════════════════════════════════════
// Role Matrix — REQ-04 Single Source of Truth
//
// Defines which sidebar nav items and which frontend routes each role
// is allowed to see. The backend has its own `requireRole` enforcement
// on write endpoints; this module owns the read-side visibility in
// the UI (nav filtering + route guards).
//
// Roles recognized:
//   admin   — full access (legacy fallback too — unknown/missing role
//             is treated as admin to avoid locking users out during
//             rollout).
//   planner — planning + execution + rate management + shipments.
//             Finance menus (invoices, audit, bids) are hidden.
//   finance — freight invoices, rate management, lane preferences,
//             carrier bids, freight audit, analytics/reports. Planning
//             and execution menus are hidden.
//
// Each role also gets a minimal common set (Home, Dashboard, Settings).
// ═══════════════════════════════════════════════════════════════════

// Nav item *labels* from Layout.jsx — keeping the match on the visible
// label is the simplest thing that works and avoids coupling to path
// strings. Every label below must exist in Layout.jsx's navStructure.
const COMMON = ["Home", "Dashboard", "Settings"];

const PLANNING = [
  "Item Master", "Location Master", "Equipment Master",
  "Shipments", "Orders", "Route Optimizer",
  "Bulk Plan", "Multi-Stop Routes", "Planning Params",
];

const EXECUTION = [
  "Live Tracking", "Carriers", "Carrier Portal",
  "Dock Scheduling", "Fleet Management", "Compliance",
];

const FINANCE = [
  "Freight Invoices", "Rate Management", "Fuel Surcharge", "Lane Preferences",
  "Carrier Bids", "Freight Audit",
];

const DOCS = ["Documents & BOL", "Customer Portal"];

const INTEGRATION = ["Messaging Hub"];

const INSIGHTS = [
  "Network Modeling", "Analytics", "Reports", "Alerts", "DB Explorer",
];

const SYSTEM = ["User Roles", "User Management"];

// Whitelist of allowed nav labels per role.
export const ROLE_NAV = {
  admin: [
    ...COMMON, ...PLANNING, ...EXECUTION, ...FINANCE,
    ...DOCS, ...INTEGRATION, ...INSIGHTS, ...SYSTEM,
  ],
  planner: [
    ...COMMON,
    ...PLANNING, ...EXECUTION, ...DOCS,
    "Rate Management",          // crosses into Finance (per requirement)
    "Fuel Surcharge",           // rides with Rate Management (migration 045)
    "Lane Preferences",
    "Analytics", "Reports",     // read-only insights
    "Messaging Hub",
  ],
  finance: [
    ...COMMON,
    ...FINANCE,
    "Documents & BOL",
    "Analytics", "Reports", "Alerts",
  ],
};

// Routes (by React-Router path) that match each label. Used by the
// frontend route guard. Keep in sync with App.jsx.
//
// Only the labels that map to a different path than label-slug are
// listed here; everything else is derived on the fly.
const LABEL_TO_PATH = {
  "Home": "/",
  "Dashboard": "/dashboard",
  "Item Master": "/item-master",
  "Location Master": "/location-master",
  "Equipment Master": "/equipment-master",
  "Shipments": "/shipments",
  "Orders": "/orders",
  "Route Optimizer": "/route-optimizer",
  "Bulk Plan": "/bulk-plan",
  "Multi-Stop Routes": "/multi-stop-routes",
  "Planning Params": "/planning-parameters",
  "Live Tracking": "/live-tracking",
  "Carriers": "/carriers",
  "Carrier Portal": "/carrier-portal",
  "Dock Scheduling": "/dock-scheduling",
  "Fleet Management": "/fleet-management",
  "Compliance": "/compliance",
  "Freight Invoices": "/freight-invoices",
  "Rate Management": "/rate-management",
  "Fuel Surcharge": "/fuel-surcharge",
  "Lane Preferences": "/lane-preferences",
  "Carrier Bids": "/carrier-bids",
  "Freight Audit": "/freight-audit",
  "Documents & BOL": "/documents",
  "Customer Portal": "/customer-portal",
  "Messaging Hub": "/messaging",
  "Network Modeling": "/network-modeling",
  "Analytics": "/analytics",
  "Reports": "/reports",
  "Alerts": "/alerts",
  "DB Explorer": "/db-explorer",
  "User Roles": "/user-roles",
  "User Management": "/user-management",
  "Settings": "/settings",
};

/** Normalize a role string into one of {admin, planner, finance} or
 *  fall back to 'admin' (safe default during rollout). */
export function canonicalRole(roleStr) {
  const r = String(roleStr || "").toLowerCase().trim();
  if (r === "planner") return "planner";
  if (r === "finance" || r === "finance_user" || r === "finance-user") return "finance";
  // Super-admin + dispatcher + legacy roles all fall through to admin-like access.
  return "admin";
}

/** Which nav labels are visible for a given user role? */
export function visibleNavLabels(role) {
  return new Set(ROLE_NAV[canonicalRole(role)] || ROLE_NAV.admin);
}

/** Is this nav item visible for the given role? */
export function canSeeNav(label, role) {
  return visibleNavLabels(role).has(label);
}

/** Is this route-path reachable for the given role? */
export function canAccessPath(path, role) {
  const r = canonicalRole(role);
  const visible = visibleNavLabels(r);
  // Find the label that maps to this path
  const label = Object.keys(LABEL_TO_PATH).find((k) => LABEL_TO_PATH[k] === path);
  // If the path isn't in our map, default to visible for admin only.
  if (!label) return r === "admin";
  return visible.has(label);
}

/** Return the landing path the role should be bounced to when it
 *  lacks access to the page it tried to visit. */
export function landingPathFor(role) {
  const r = canonicalRole(role);
  if (r === "finance") return "/freight-invoices";
  if (r === "planner") return "/orders";
  return "/";
}

export const _test = { LABEL_TO_PATH, PLANNING, EXECUTION, FINANCE };
