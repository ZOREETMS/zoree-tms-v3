export const QUICK_QUERIES = [
  { label: "All Orders", sql: "SELECT * FROM orders ORDER BY created_at DESC LIMIT 50" },
  { label: "All Shipments", sql: "SELECT * FROM shipments ORDER BY created_at DESC LIMIT 50" },
  { label: "All Carriers", sql: "SELECT * FROM carriers ORDER BY name" },
  { label: "All Rates", sql: "SELECT * FROM rates ORDER BY lane" },
  { label: "All Drivers", sql: "SELECT * FROM drivers ORDER BY name" },
  { label: "Orders by Status", sql: "SELECT status, COUNT(*) AS count FROM orders GROUP BY status ORDER BY count DESC" },
  { label: "Spend by Carrier", sql: "SELECT carrier, COUNT(*) AS shipments, SUM(total_cost) AS total_spend FROM shipments GROUP BY carrier ORDER BY total_spend DESC" },
  // Bug #169: include `lane` (carries the expiry-date suffix) and the
  // explicit expiry column aliases so the rates view stops dropping
  // effective_end / expiry information from the DB Explorer table.
  { label: "Active Rates", sql: "SELECT lane, origin, dest, carrier, mode, rate, fsc, czarlite, exp, expiry_date FROM rates WHERE status = 'Active' ORDER BY origin, dest" },
];

// Bug #173: surface dock-scheduling, document (BOL/POD), and equipment
// reference tables in the DB Explorer picker so planners and finance
// can audit them without writing raw queries. All four tables are
// already on the server's ALLOWED list (api/server.js) so the proxy
// accepts these reads without any schema/policy change.
export const DB_TABLES = [
  "orders",
  "shipments",
  "carriers",
  "rates",
  "drivers",
  "locations",
  "items",
  "invoices",
  "lane_preferences",
  "packaging_units",
  "dock_appointments",       // bug #173 — dock scheduling (derived; see dbExplorerCatalog)
  "warehouse_dock_config",   // bug #173 — dock master config
  "documents",               // bug #173 — BOL / POD storage
  "equipment_types",         // bug #173 — trailer + LTL ceilings
  // QA #312 — the sidebar previously listed the four bug-#173 tables
  // but the underlying catalog (dbExplorerService) didn't map them,
  // so clicking the entries returned "Table not found". The catalog
  // is now in services/dbExplorerCatalog.js. Surfacing two more
  // already-loaded tables for completeness:
  "planning_parameters",
  "route_templates",
];
