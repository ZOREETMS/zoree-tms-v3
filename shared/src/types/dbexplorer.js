export const QUICK_QUERIES = [
  { label: "All Orders", sql: "SELECT * FROM orders ORDER BY created_at DESC LIMIT 50" },
  { label: "All Shipments", sql: "SELECT * FROM shipments ORDER BY created_at DESC LIMIT 50" },
  { label: "All Carriers", sql: "SELECT * FROM carriers ORDER BY name" },
  { label: "All Rates", sql: "SELECT * FROM rates ORDER BY lane" },
  { label: "All Drivers", sql: "SELECT * FROM drivers ORDER BY name" },
  { label: "Orders by Status", sql: "SELECT status, COUNT(*) AS count FROM orders GROUP BY status ORDER BY count DESC" },
  { label: "Spend by Carrier", sql: "SELECT carrier, COUNT(*) AS shipments, SUM(total_cost) AS total_spend FROM shipments GROUP BY carrier ORDER BY total_spend DESC" },
  { label: "Active Rates", sql: "SELECT origin, dest, carrier, mode, rate, fsc, czarlite FROM rates WHERE status = 'Active' ORDER BY origin, dest" },
];

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
];
