/**
 * Order Import Service
 * ─────────────────────
 * Pure logic for the "Import Orders (CSV / Excel)" flow on OrdersPage.
 * Owns header-mapping, row normalization, per-row validation, and the
 * call to the bulk-import API so the modal stays a thin presentational
 * layer (CLAUDE_RULES §2 — services-first; §6/§9 — no large inline blocks;
 * §4 — all API access through the services layer).
 *
 * Server contract (api/server.js → POST /api/bulk-plan/import):
 *   request:  { orders: [{ customer, origin, destination, weight?,
 *                          pieces?, commodity?, readyDate?, dueDate? }, ...] }
 *   response: { created, orders, errors: [{ row, message }] }
 *
 * Header matching is case + whitespace insensitive and accepts a handful
 * of common aliases so a re-saved Excel sheet with slightly mangled
 * headers still imports cleanly.
 */

import * as XLSX from "xlsx";
import { BulkPlanApi } from "../lib/api";

/* ─────────────────────────────────────────────────────────────
 * Header → canonical-field mapping
 * ───────────────────────────────────────────────────────────── */

// Header aliases — case + whitespace insensitive (see normalizeHeaderKey).
//
// REQ for TMS bugs #143 / #145: previously this map only covered the eight
// "minimum viable" columns. Even when the import file carried PO Number,
// Ship Mode, Service Level, Notes, Ship From / Ship To name labels, or
// the broken-out zip codes, those values were silently ignored because
// the canonical key wasn't recognized here. Every field below now flows
// straight through to api/services/orderMutations.js#apiOrderToDbPatch
// (which the import handler routes through after Step B), so adding a
// canonical key here is the entire frontend half of "make this column
// land in the database".
//
// Address fields (#143 — separate columns chosen by product over
// single-cell parsing): name labels and zips are accepted as their own
// columns. The full free-text address still goes in `Origin` /
// `Destination` so we keep matching the existing manual-create UX where
// `origin` is one string and `origin_zip` / `ship_from_name` are
// auxiliary. No single-cell address parsing — a missing zip column
// stays null rather than us guessing at parse time.
const HEADER_ALIASES = {
  customer:     ["customer", "customer name", "shipper", "client", "account"],
  origin:       ["origin", "ship from", "shipfrom", "from", "pickup", "pickup location", "origin location"],
  destination:  ["destination", "dest", "ship to", "shipto", "to", "delivery", "delivery location", "dest location"],
  shipFromName: ["ship from name", "shipfromname", "origin name", "from name", "ship from label"],
  shipToName:   ["ship to name", "shiptoname", "destination name", "to name", "ship to label"],
  originZip:    ["origin zip", "originzip", "from zip", "ship from zip", "ship from zip code", "origin postal", "origin postal code"],
  destZip:      ["destination zip", "destzip", "dest zip", "to zip", "ship to zip", "ship to zip code", "destination postal", "destination postal code"],
  weight:       ["weight", "weight (lbs)", "weight lbs", "wt", "lbs", "pounds"],
  pieces:       ["pieces", "qty", "quantity", "units", "pcs", "count"],
  commodity:    ["commodity", "product", "freight", "description"],
  poNum:        ["po number", "po num", "po", "po#", "po #", "purchase order", "purchase order number", "ponumber"],
  shipMode:     ["mode", "ship mode", "shipmode", "service mode", "transport mode", "transportation mode"],
  serviceLevel: ["service level", "servicelevel", "priority", "service", "service type"],
  notes:        ["notes", "comments", "special instructions", "instructions", "remarks"],
  readyDate:    ["ready date", "ready", "pickup date", "pickup_date", "readydate"],
  dueDate:      ["due date", "due", "delivery date", "delivery_date", "duedate"],
};

const REQUIRED_FIELDS = ["customer", "origin", "destination"];

/** Lower-cased + trimmed + collapse-whitespace key for header lookup. */
function normalizeHeaderKey(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Build a `header(text) → canonical(field)` map for the supplied
 * spreadsheet headers. Headers that don't match anything map to `null`
 * so the caller can warn the user about ignored columns instead of
 * silently dropping data.
 */
export function mapHeaders(headers) {
  const map = {};
  for (const raw of headers || []) {
    const key = normalizeHeaderKey(raw);
    let matched = null;
    for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(key)) { matched = canonical; break; }
    }
    map[raw] = matched;
  }
  return map;
}

/**
 * Read one sheet as { headers, rows } where rows are header-keyed objects
 * and empty rows are skipped. Pure helper used by parseOrderFile for both
 * the Orders sheet and the optional Line Items sheet.
 */
function sheetToHeaderedRows(sheet) {
  // header:1 → array-of-arrays so we can capture the original header row
  // verbatim (including casing/spacing) for `mapHeaders`.
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  if (!aoa.length) return { headers: [], rows: [] };
  const headers = (aoa[0] || []).map((h) => String(h || "").trim());
  const rows = [];
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i];
    if (!row || row.every((c) => c === "" || c == null)) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = row[idx] !== undefined ? row[idx] : ""; });
    rows.push(obj);
  }
  return { headers, rows };
}

/**
 * Find a sheet by name, case + whitespace insensitive. Returns null if
 * not present so callers can treat the Line Items sheet as optional.
 */
function findSheetByName(wb, target) {
  const want = String(target || "").toLowerCase().replace(/\s+/g, " ").trim();
  for (const name of wb.SheetNames || []) {
    const got = String(name).toLowerCase().replace(/\s+/g, " ").trim();
    if (got === want) return wb.Sheets[name];
  }
  return null;
}

/**
 * Parse a File or Blob (CSV / XLSX / XLSM / XLS).
 *
 * The first sheet is treated as the Orders sheet. If a second sheet
 * named "Line Items" exists (case + whitespace insensitive), it is also
 * parsed; analyzeOrderUpload then groups its rows by "Order Row #" and
 * attaches them to each order's payload as `lineItems[]` (TMS bug #144).
 *
 * Empty rows are dropped on both sheets. Dates come back as strings in
 * `YYYY-MM-DD` form so the downstream payload doesn't have to deal with
 * Excel's serial-day numbers.
 *
 * @returns {Promise<{
 *   headers:         string[],          // Orders sheet header row
 *   rows:            Object[],          // Orders sheet data rows
 *   lineItemHeaders: string[],          // Line Items sheet header row ([] if absent)
 *   lineItemRows:    Object[],          // Line Items sheet data rows ([] if absent)
 * }>}
 */
export async function parseOrderFile(file) {
  if (!file) throw new Error("parseOrderFile: file is required");
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Workbook contains no sheets");
  const ordersSheet = wb.Sheets[sheetName];
  const { headers, rows } = sheetToHeaderedRows(ordersSheet);

  // The Line Items sheet is optional. Keep parseOrderFile happy on
  // single-sheet (8-column legacy) imports by defaulting to empty arrays.
  const linesSheet = findSheetByName(wb, "Line Items");
  const { headers: lineItemHeaders, rows: lineItemRows } = linesSheet
    ? sheetToHeaderedRows(linesSheet)
    : { headers: [], rows: [] };

  return { headers, rows, lineItemHeaders, lineItemRows };
}

/* ─────────────────────────────────────────────────────────────
 * Line Items sheet — header aliases + normalization (TMS bug #144)
 * ───────────────────────────────────────────────────────────── */

// Linkage column: "Order Row #" matches the 1-based data-row index in
// the Orders sheet (1 = first non-header row). Auxiliary aliases
// accommodate spreadsheets exported from various tools.
//
// QA #339 — testers reported "Line item data is not captured and error
// is shown during import" after adding "Line Item Number/ID" columns
// to the Line Items sheet. Root cause: the alias lists for lineNum
// and itemId did not include the natural "Line Item …" prefix that
// users reach for when laying out the sheet from scratch (the
// pre-existing aliases assumed people would type the bare "Line" /
// "Item ID" labels from the documented template). When the header
// didn't match, mapLineItemHeaders silently dropped the column,
// every Line Items row ended up with `orderRow: null`, and the
// analyzer counted them all as "unattached" — which OrderImportModal
// surfaces as a warning banner that the tester read as the import
// error. The expanded aliases below cover the common QA phrasings
// without losing any of the previously-accepted variants.
const LINE_ITEM_HEADER_ALIASES = {
  orderRow:    ["order row", "order row #", "order row number", "order #", "order number", "order index"],
  lineNum:     [
    "line", "line #", "line num", "line number",
    // QA #339 — "Line Item Number" family.
    "line item", "line item #", "line item num", "line item number",
  ],
  itemId:      [
    "item id", "item", "sku", "item code", "itemid", "item_id",
    // QA #339 — "Line Item Number/ID" and related natural phrasings.
    "item number", "item #", "item num",
    "line item id", "line item code",
    "line item number/id", "item number/id",
  ],
  description: ["description", "item description", "product", "freight"],
  qtyOrdered:  ["qty", "quantity", "qty ordered", "pieces", "units"],
  unitWeight:  ["unit weight", "unit wt", "weight per unit", "wt per unit"],
  totalWeight: ["total weight", "total wt", "line weight"],
};

export function mapLineItemHeaders(headers) {
  const map = {};
  for (const raw of headers || []) {
    const key = normalizeHeaderKey(raw);
    let matched = null;
    for (const [canonical, aliases] of Object.entries(LINE_ITEM_HEADER_ALIASES)) {
      if (aliases.includes(key)) { matched = canonical; break; }
    }
    map[raw] = matched;
  }
  return map;
}

/**
 * Convert one Line Items raw row into the shape the import API expects.
 * Pure. Returns null for blank rows so callers can drop them cleanly.
 */
export function normalizeLineItemRow(rawRow, headerMap) {
  const f = {};
  for (const [hdr, canonical] of Object.entries(headerMap)) {
    if (!canonical) continue;
    const val = rawRow[hdr];
    if (val === undefined) continue;
    f[canonical] = typeof val === "string" ? val.trim() : val;
  }
  const str = (v) => (v === undefined || v === null || v === "") ? "" : String(v).trim();
  const orderRow = toNumberOrNull(f.orderRow);
  const description = str(f.description);
  const itemId      = str(f.itemId);
  const qty         = toNumberOrNull(f.qtyOrdered);

  // Drop entirely blank rows: no order linkage AND no description /
  // item / qty signal. Saves the caller a defensive filter.
  if (orderRow == null && !description && !itemId && (qty == null || qty === 0)) {
    return null;
  }

  return {
    orderRow:    orderRow,                     // null if missing — caller flags
    lineNum:     toNumberOrNull(f.lineNum),    // null = sequential auto-assign server-side
    itemId:      itemId || null,
    description: description,
    qtyOrdered:  qty != null ? qty : 0,
    unitWeight:  toNumberOrNull(f.unitWeight),
    totalWeight: toNumberOrNull(f.totalWeight),
  };
}

/* ─────────────────────────────────────────────────────────────
 * Cell-value normalizers
 * ───────────────────────────────────────────────────────────── */

function toNumberOrNull(v) {
  if (v === "" || v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toIsoDateOrNull(v) {
  if (v === "" || v == null) return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // US-style M/D/YYYY → ISO
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [, mo, da, yr] = m;
    if (yr.length === 2) yr = (parseInt(yr, 10) >= 70 ? "19" : "20") + yr;
    return `${yr}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

/* ─────────────────────────────────────────────────────────────
 * Row → API-payload normalization
 * ───────────────────────────────────────────────────────────── */

/**
 * Convert one header-keyed raw row (as produced by `parseOrderFile`)
 * into the payload shape `/api/bulk-plan/import` expects. Pure — no IO.
 *
 * `headerMap` is the dictionary returned from `mapHeaders`.
 */
export function normalizeUploadedRow(rawRow, headerMap) {
  const f = {};
  for (const [hdr, canonical] of Object.entries(headerMap)) {
    if (!canonical) continue;
    const val = rawRow[hdr];
    if (val === undefined) continue;
    f[canonical] = typeof val === "string" ? val.trim() : val;
  }

  // Local helper: trim a string-ish cell or return "" so empty cells don't
  // leak `undefined` / numbers into the API body. Numbers (zip codes
  // entered without a leading zero, for example) get coerced to strings
  // so the server-side mapper isn't fed mixed types.
  const str = (v) => (v === undefined || v === null || v === "") ? "" : String(v).trim();

  return {
    // ── Header fields ──
    customer:     str(f.customer),
    origin:       str(f.origin),
    destination:  str(f.destination),
    // ── Address auxiliaries (bug #143) ──
    // Name labels are free text; zips are coerced to string to preserve
    // a leading zero that XLSX would have read as a number.
    shipFromName: str(f.shipFromName),
    shipToName:   str(f.shipToName),
    originZip:    str(f.originZip),
    destZip:      str(f.destZip),
    // ── Quantities ──
    weight:       toNumberOrNull(f.weight),
    pieces:       toNumberOrNull(f.pieces),
    // ── Reference fields (bug #145) ──
    commodity:    str(f.commodity),
    poNum:        str(f.poNum),
    shipMode:     str(f.shipMode),
    serviceLevel: str(f.serviceLevel),
    notes:        str(f.notes),
    // ── Dates ──
    readyDate:    toIsoDateOrNull(f.readyDate),
    dueDate:      toIsoDateOrNull(f.dueDate),
  };
}

/* ─────────────────────────────────────────────────────────────
 * Per-row validation
 * ───────────────────────────────────────────────────────────── */

/**
 * Validate the *raw* (header-keyed) row plus its normalized payload.
 * Returns `{ ok, errors[] }` where `errors` describe the user-visible
 * problems with that row. Empty `errors` ⇒ row is safe to import.
 */
export function validateOrderRow(rawRow, headerMap, payload) {
  const errors = [];

  for (const field of REQUIRED_FIELDS) {
    const headerEntry = Object.entries(headerMap).find(([, c]) => c === field);
    const headerName = headerEntry ? headerEntry[0] : field;
    const raw = headerEntry ? rawRow[headerEntry[0]] : null;
    const present = raw !== undefined && raw !== null && String(raw).trim() !== "";
    if (!present) errors.push(`${headerName} is required`);
  }

  if (payload.weight != null && payload.weight < 0) {
    errors.push("Weight cannot be negative");
  }
  if (payload.pieces != null && payload.pieces < 0) {
    errors.push("Pieces cannot be negative");
  }
  if (payload.readyDate && payload.dueDate && payload.readyDate > payload.dueDate) {
    errors.push("Ready Date must be on or before Due Date");
  }

  return { ok: errors.length === 0, errors };
}

/* ─────────────────────────────────────────────────────────────
 * Top-level analysis used by the modal
 * ───────────────────────────────────────────────────────────── */

/**
 * Analyze the parsed rows against the supplied header map. Returns a
 * summary the modal renders directly:
 *
 *   {
 *     headerMap,
 *     unmappedHeaders: string[],
 *     analyzed: Array<{
 *       rowNumber,                 // 1-based excluding header
 *       raw:    Object,
 *       payload: Object,           // includes lineItems[] when matched
 *       errors: string[],
 *     }>,
 *     counts: { total, valid, invalid,
 *               lineItemsTotal,    // total normalized lines in the sheet
 *               ordersWithLines,   // analyzed orders that received lines
 *               unattachedLineItems // lines whose Order Row # didn't match
 *             },
 *     lineItemHeaderMap,
 *     unmappedLineItemHeaders,
 *   }
 *
 * Accepts the extended parseOrderFile shape — `lineItemHeaders` and
 * `lineItemRows` are optional so legacy single-sheet imports keep working.
 */
export function analyzeOrderUpload({ headers, rows, lineItemHeaders, lineItemRows }) {
  const headerMap = mapHeaders(headers);
  const unmappedHeaders = Object.entries(headerMap)
    .filter(([, c]) => !c)
    .map(([h]) => h)
    .filter(Boolean);

  const analyzed = (rows || []).map((raw, i) => {
    const payload = normalizeUploadedRow(raw, headerMap);
    const { errors } = validateOrderRow(raw, headerMap, payload);
    return {
      rowNumber: i + 2, // +1 for 1-based, +1 for the header row
      raw,
      payload,
      errors,
    };
  });

  // ── Line items linkage (bug #144) ──────────────────────────────────
  // Group normalized line-item rows by "Order Row #" (1-based index
  // into the Orders sheet's data rows; Order Row 1 = first non-header
  // row = analyzed[0]). Drop blank rows during normalization. Lines
  // whose Order Row # is missing or out of range count as "unattached"
  // so the modal can warn instead of silently losing data.
  const lineItemHeaderMap = mapLineItemHeaders(lineItemHeaders || []);
  const unmappedLineItemHeaders = Object.entries(lineItemHeaderMap)
    .filter(([, c]) => !c)
    .map(([h]) => h)
    .filter(Boolean);

  let lineItemsTotal      = 0;
  let unattachedLineItems = 0;
  const linesByOrderRow   = new Map();

  for (const raw of (lineItemRows || [])) {
    const li = normalizeLineItemRow(raw, lineItemHeaderMap);
    if (!li) continue;                                  // blank row
    lineItemsTotal++;
    const idx0 = (Number(li.orderRow) || 0) - 1;        // 1-based → 0-based
    if (idx0 < 0 || idx0 >= analyzed.length) {
      unattachedLineItems++;
      continue;
    }
    if (!linesByOrderRow.has(idx0)) linesByOrderRow.set(idx0, []);
    linesByOrderRow.get(idx0).push(li);
  }

  let ordersWithLines = 0;
  analyzed.forEach((a, idx) => {
    const ls = linesByOrderRow.get(idx);
    if (ls && ls.length > 0) {
      // Re-number sequentially within the order (1..N) so users who
      // leave Line # blank still get a clean 1..N sequence on the
      // saved order. Explicit Line # values are preserved.
      a.payload.lineItems = ls.map((li, j) => ({
        ...li,
        lineNum: li.lineNum != null ? li.lineNum : j + 1,
      }));
      ordersWithLines++;
    }
  });

  const counts = {
    total:   analyzed.length,
    valid:   analyzed.filter((a) => a.errors.length === 0).length,
    invalid: analyzed.filter((a) => a.errors.length  >  0).length,
    lineItemsTotal,
    ordersWithLines,
    unattachedLineItems,
  };

  return {
    headerMap,
    unmappedHeaders,
    analyzed,
    counts,
    lineItemHeaderMap,
    unmappedLineItemHeaders,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Bulk import
 * ───────────────────────────────────────────────────────────── */

/**
 * Persist a list of analyzed rows via `/api/bulk-plan/import`. Rows with
 * validation errors are dropped here too — the UI already filters them
 * but the service owns the contract (CLAUDE_RULES §4).
 *
 * Reports progress via `onProgress({ completed, total })` after each
 * chunk so the modal can render a progress bar without polling.
 *
 * Returns `{
 *   created:         number,                       // total inserted rows
 *   createdOrderIds: string[],                     // ORD-… ids in the
 *                                                  // order the API
 *                                                  // reported them
 *   failed:          [{ rowNumber, customer, error }],
 * }`.
 *
 * `createdOrderIds` exists so the caller can surface the new order
 * numbers in the success toast (TMS bug #142 — the post-import message
 * was a generic "Imported N orders" that hid the ids the user needs to
 * navigate / copy).
 */
export async function bulkImportOrders(analyzed, {
  chunkSize  = 50,
  onProgress = null,
} = {}) {
  const out = { created: 0, createdOrderIds: [], failed: [] };
  const queue = (analyzed || []).filter((a) => a.errors.length === 0);
  const total = queue.length;
  if (total === 0) return out;

  for (let i = 0; i < queue.length; i += chunkSize) {
    const slice = queue.slice(i, i + chunkSize);
    try {
      const res = await BulkPlanApi.import(slice.map((a) => a.payload));
      out.created += Number(res?.created || 0);
      // Capture the new order ids the server echoed back so the UI can
      // show them in the success toast (bug #142). The endpoint returns
      // the inserted row(s) under `orders`; each row is the persisted
      // shape from Supabase, so `.id` is the ORD-… identifier.
      const createdRows = Array.isArray(res?.orders) ? res.orders : [];
      for (const row of createdRows) {
        if (row && row.id) out.createdOrderIds.push(String(row.id));
      }
      const errs = Array.isArray(res?.errors) ? res.errors : [];
      for (const e of errs) {
        // Server `row` index is 1-based within the request body;
        // map back to the original spreadsheet rowNumber.
        const localIdx = (Number(e.row) || 1) - 1;
        const item = slice[localIdx];
        out.failed.push({
          rowNumber: item?.rowNumber ?? null,
          customer:  item?.payload?.customer || "",
          error:     e?.message || "Unknown server error",
        });
      }
    } catch (err) {
      // Whole-chunk failure — attribute to every row in the chunk.
      for (const item of slice) {
        out.failed.push({
          rowNumber: item.rowNumber,
          customer:  item.payload?.customer || "",
          error:     err?.message || String(err),
        });
      }
    }
    if (onProgress) onProgress({ completed: Math.min(i + chunkSize, total), total });
  }

  return out;
}

/* ─────────────────────────────────────────────────────────────
 * Template download (mirrors the rate-template UX)
 * ───────────────────────────────────────────────────────────── */

// Required columns come first (anyone editing in Excel sees them
// immediately); optional auxiliaries — added in the bug #143 / #145 fix
// — come after. Users who already have legacy 8-column sheets still
// import cleanly because every new column is optional.
const TEMPLATE_HEADERS = [
  "Customer", "Origin", "Destination", "Weight (lbs)", "Pieces",
  "Commodity", "Ready Date", "Due Date",
  // Address auxiliaries (#143)
  "Ship From Name", "Origin Zip", "Ship To Name", "Destination Zip",
  // Reference fields (#145)
  "PO Number", "Mode", "Service Level", "Notes",
];

const TEMPLATE_SAMPLE_ROWS = [
  [
    "Cisco Systems", "Chicago, IL 60601", "Dallas, TX 75201", 12000, 24, "Network Equipment",
    "2026-05-10", "2026-05-13",
    "Cisco Chicago DC", "60601", "Cisco Dallas DC", "75201",
    "PO-487231", "TL", "Standard", "Dock 4 — call 30 min ahead",
  ],
  [
    "Acme Corp", "Atlanta, GA 30301", "Miami, FL 33101", 4500, 10, "General",
    "2026-05-11", "2026-05-15",
    "Acme Atlanta WH", "30301", "Acme Miami DC", "33101",
    "PO-487232", "LTL", "Expedited", "",
  ],
];

// Line Items sheet (TMS bug #144). Optional companion to the Orders sheet.
//
// Linkage: "Order Row #" is the 1-based index into the Orders sheet's
// data rows (1 = first non-header row). So the lines below belong to:
//   Order Row 1 → "Cisco Systems …" (the first sample order)
//   Order Row 2 → "Acme Corp …"     (the second sample order)
// "Line #" is optional — if blank, lines are auto-numbered 1..N in the
// order they appear within their Order Row group.
const LINE_ITEM_TEMPLATE_HEADERS = [
  "Order Row #", "Line #", "Item ID", "Description", "Qty", "Unit Wt", "Total Wt",
];

const LINE_ITEM_TEMPLATE_SAMPLE_ROWS = [
  [1, 1, "ITM-1004", "Cisco Catalyst 9300 — 24-port",  10, 38, 380],
  [1, 2, "ITM-1006", "Cisco Catalyst 9500 — 48-port",   5, 52, 260],
  [1, 3, "ITM-2110", "SFP-10G-LR optical module",      40,  1,  40],
  [2, 1, "ITM-3300", "Office supplies — assorted",     10, 25, 250],
  [2, 2, "",         "Pallet wrap and labels",          5, 10,  50],
];

/**
 * Trigger a browser download of a starter XLSX template. Two sheets:
 *   • "Orders"     — required header row + 8 required + 8 optional cols
 *   • "Line Items" — optional, links by Order Row #
 *
 * Single-sheet legacy templates still import cleanly because the parser
 * treats the Line Items sheet as optional.
 */
export function downloadOrderTemplate() {
  const wb = XLSX.utils.book_new();

  const ordersAoa = [TEMPLATE_HEADERS, ...TEMPLATE_SAMPLE_ROWS];
  const ordersWs  = XLSX.utils.aoa_to_sheet(ordersAoa);
  XLSX.utils.book_append_sheet(wb, ordersWs, "Orders");

  const linesAoa = [LINE_ITEM_TEMPLATE_HEADERS, ...LINE_ITEM_TEMPLATE_SAMPLE_ROWS];
  const linesWs  = XLSX.utils.aoa_to_sheet(linesAoa);
  XLSX.utils.book_append_sheet(wb, linesWs, "Line Items");

  XLSX.writeFile(wb, "order_import_template.xlsx");
}
