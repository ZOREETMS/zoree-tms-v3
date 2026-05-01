/**
 * Export service — entity column maps + filename builder + dispatcher.
 *
 * Pages call `exportEntityToExcel(entity, rows)` (typically via the shared
 * <ExportButton/>). The service owns:
 *   - which columns each entity exports (mirrors the visible grid),
 *   - how rows are formatted (dates, money, fallbacks),
 *   - filename convention.
 *
 * UI never imports `xlsx` directly — it goes through utils/excelExport.js.
 */

import { writeRowsToExcel } from "../utils/excelExport";

/* ── Filename builder ─────────────────────────────────────────────── */

function pad2(n) { return String(n).padStart(2, "0"); }

export function buildExportFilename(prefix) {
  const d = new Date();
  const stamp =
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `_${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  return `zoree_${prefix}_${stamp}.xlsx`;
}

/* ── Column maps (mirror the visible grids) ───────────────────────── */

const ORDERS_COLUMNS = [
  { header: "Order ID",    accessor: "id" },
  { header: "Customer",    accessor: "customer" },
  { header: "Origin",      accessor: "origin" },
  { header: "Destination", accessor: "dest" },
  { header: "Weight (lbs)", accessor: (o) => Number(o.weight || 0) },
  { header: "Pieces",      accessor: (o) => Number(o.pieces || 0) },
  { header: "Commodity",   accessor: "commodity" },
  { header: "Ready",       accessor: (o) => o.ready || o.pickup_date || "" },
  { header: "Due",         accessor: (o) => o.due || o.delivery_date || "" },
  { header: "Shipment",    accessor: "shipment_id" },
  { header: "Ship Mode",   accessor: (o) => o.ship_mode || o.shipMode || "" },
  { header: "Service Level", accessor: (o) => o.service_level || o.serviceLevel || "" },
  { header: "Status",      accessor: "status" },
];

const SHIPMENTS_COLUMNS = [
  { header: "Shipment ID", accessor: "id" },
  { header: "Origin",      accessor: "origin" },
  { header: "Destination", accessor: "dest" },
  { header: "Mode",        accessor: "mode" },
  { header: "Equipment",   accessor: (s) => s.equipment || "" },
  { header: "Carrier",     accessor: "carrier" },
  { header: "Weight (lbs)", accessor: (s) => Number(s.weight || 0) },
  { header: "Est. Cost",   accessor: (s) => Number(s.total_cost || s.totalCost || 0) },
  { header: "Rate",        accessor: (s) => Number(s.rate || 0) },
  { header: "Fuel Surcharge", accessor: (s) => Number(s.fuel_surcharge || 0) },
  { header: "Accessorials", accessor: (s) => Number(s.accessorials || 0) },
  { header: "Pickup",      accessor: (s) => s.pickup_date || "" },
  { header: "Delivery",    accessor: (s) => s.delivery_date || "" },
  { header: "Transit Days", accessor: (s) => s.transit_days ?? "" },
  { header: "Service Level", accessor: (s) => s.service_level || "" },
  { header: "Status",      accessor: "status" },
];

const RATES_COLUMNS = [
  { header: "Lane",        accessor: "lane" },
  { header: "Origin",      accessor: "origin" },
  { header: "Destination", accessor: "dest" },
  { header: "Carrier",     accessor: "carrier" },
  { header: "Mode",        accessor: "mode" },
  { header: "Match Type",  accessor: "match_type" },
  { header: "Rate",        accessor: "rate" },
  { header: "Unit",        accessor: "unit" },
  { header: "FSC",         accessor: "fsc" },
  { header: "Discount %",  accessor: "discount" },
  { header: "Discount $",  accessor: "discountFlat" },
  { header: "Service Level", accessor: "service_level" },
  { header: "Transit Days", accessor: (r) => r.transitDays ?? r.transit_days ?? "" },
  { header: "Miles",       accessor: "miles" },
  { header: "Effective",   accessor: (r) => r.eff || r.effective_date || "" },
  { header: "Expires",     accessor: (r) => r.exp || r.expiry_date || "" },
  { header: "Status",      accessor: "status" },
];

/* ── Entity registry ──────────────────────────────────────────────── */

const REGISTRY = {
  orders:    { columns: ORDERS_COLUMNS,    sheetName: "Orders",    filenamePrefix: "orders" },
  shipments: { columns: SHIPMENTS_COLUMNS, sheetName: "Shipments", filenamePrefix: "shipments" },
  rates:     { columns: RATES_COLUMNS,     sheetName: "Rates",     filenamePrefix: "rates" },
};

export function getEntityExportConfig(entity) {
  const cfg = REGISTRY[entity];
  if (!cfg) throw new Error(`exportService: unknown entity "${entity}"`);
  return cfg;
}

/* ── Public API ───────────────────────────────────────────────────── */

/**
 * Export filtered/sorted rows for a known entity.
 * Returns the filename used, or throws on misuse.
 */
export function exportEntityToExcel(entity, rows) {
  const { columns, sheetName, filenamePrefix } = getEntityExportConfig(entity);
  const filename = buildExportFilename(filenamePrefix);
  writeRowsToExcel({ rows: rows || [], columns, sheetName, filename });
  return filename;
}
