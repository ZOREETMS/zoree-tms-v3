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
 * Parse a File or Blob (CSV / XLSX / XLSM / XLS) into a list of
 * header-keyed plain objects. The first sheet is read; empty rows are
 * dropped. Dates come back as strings in `YYYY-MM-DD` form so the
 * downstream payload doesn't have to deal with Excel's serial-day numbers.
 *
 * @returns {Promise<{ headers: string[], rows: Object[] }>}
 */
export async function parseOrderFile(file) {
  if (!file) throw new Error("parseOrderFile: file is required");
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Workbook contains no sheets");
  const sheet = wb.Sheets[sheetName];
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
 *       payload: Object,
 *       errors: string[],
 *     }>,
 *     counts: { total, valid, invalid },
 *   }
 */
export function analyzeOrderUpload({ headers, rows }) {
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

  const counts = {
    total:   analyzed.length,
    valid:   analyzed.filter((a) => a.errors.length === 0).length,
    invalid: analyzed.filter((a) => a.errors.length  >  0).length,
  };

  return { headerMap, unmappedHeaders, analyzed, counts };
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

/** Trigger a browser download of a starter XLSX template. */
export function downloadOrderTemplate() {
  const aoa = [TEMPLATE_HEADERS, ...TEMPLATE_SAMPLE_ROWS];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Orders");
  XLSX.writeFile(wb, "order_import_template.xlsx");
}
