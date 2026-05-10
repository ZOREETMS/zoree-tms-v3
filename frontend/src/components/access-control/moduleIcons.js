// ════════════════════════════════════════════════════════════════════
// moduleIcons — pure data: maps a feature_key (or its module section)
// to a small SVG path + tone class for the .acc-mod-ico circle.
// Plain JS module so it can be imported anywhere without bundler quirks.
// ════════════════════════════════════════════════════════════════════

const PATHS = {
  home:    '<path d="M3 9.5 12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  dash:    '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  box:     '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  pin:     '<path d="M12 22s7-7.58 7-13a7 7 0 1 0-14 0c0 5.42 7 13 7 13z"/><circle cx="12" cy="9" r="2.5"/>',
  truck:   '<path d="M1 7h13v10H1zM14 10h4l3 3v4h-7z"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/>',
  pkg:     '<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4V11M21 7v10l-9 4"/>',
  map:     '<path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3z"/><path d="M9 3v15M15 6v15"/>',
  layers:  '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5M3 18l9 5 9-5"/>',
  route:   '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 17V9a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v0"/>',
  sliders: '<path d="M4 21V14M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  bid:     '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  audit:   '<path d="M14 3h-9a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 14l2 2 4-4"/>',
  doc:     '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  portal:  '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  msg:     '<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  net:     '<circle cx="12" cy="12" r="3"/><circle cx="4" cy="6" r="2"/><circle cx="20" cy="6" r="2"/><circle cx="4" cy="18" r="2"/><circle cx="20" cy="18" r="2"/><path d="M6 7l4 3M18 7l-4 3M6 17l4-3M18 17l-4-3"/>',
  chart:   '<path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/>',
  rep:     '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h6"/>',
  bell:    '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  db:      '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  user:    '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  lock:    '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  cog:     '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  grid:    '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
};

// Try the feature_key first (covers things like "shipments", "orders",
// "route_optimizer"); fall back to a generic per-section icon.
// Keep aligned with supabase/migrations/20260506_role_module_full_catalog.sql.
const KEY_ICONS = {
  // Overview
  home:"home", dashboard:"dash",
  // Planning master data
  items:"box", item_master:"box",
  locations:"pin", location_master:"pin",
  equipments:"truck", equipment_master:"truck",
  // Planning
  shipments:"pkg", orders:"pkg", invoices:"audit",
  route_optimizer:"route", route_opt:"route",
  bulk_plan:"layers",
  multi_stop:"map", multi_stop_routes:"map",
  planning_params:"sliders", plan_params:"sliders",
  // Execution
  live_tracking:"map", carriers:"truck", carrier_portal:"portal",
  dock_scheduling:"layers", fleet_management:"truck", compliance:"audit",
  // Finance
  rate_management:"chart", lane_preferences:"route",
  carrier_bids:"bid", freight_audit:"audit",
  // Documents
  documents_bol:"doc", "documents_&_bol":"doc", documents:"doc",
  customer_portal:"portal",
  // Integration
  messaging:"msg", messaging_hub:"msg",
  // Insights
  network_modeling:"net", analytics:"chart", reports:"rep", alerts:"bell",
  db_explorer:"db",
  // System
  user_management:"user", user_roles:"lock", settings:"cog",
};

const SECTION_TONE = {
  Overview:"t1",
  Planning:"t2",
  Execution:"t2",
  Documents:"t3",
  Finance:"t3",
  Integration:"t4",
  Insights:"t5",
  System:"t3",
};

export function iconKeyFor(featureKey, section) {
  const k = String(featureKey || "").toLowerCase();
  if (KEY_ICONS[k]) return KEY_ICONS[k];
  const s = String(section || "");
  if (s === "Insights")    return "chart";
  if (s === "Documents")   return "doc";
  if (s === "Integration") return "msg";
  if (s === "Finance")     return "audit";
  if (s === "Execution")   return "route";
  if (s === "Planning")    return "layers";
  if (s === "System")      return "cog";
  return "grid";
}

export function toneFor(section) {
  return SECTION_TONE[section] || "";
}

export function iconSvg(key, size = 18) {
  const d = PATHS[key] || PATHS.grid;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
}
