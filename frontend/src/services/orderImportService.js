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

const HEADER_ALIASES = {
  customer:    ["customer", "customer name", "shipper", "client", "account"],
  origin:      ["origin", "ship from", "shipfrom", "from", "pickup", "pickup location", "origin location"],
  destination: ["destination", "dest", "ship to", "shipto", "to", "delivery", "delivery location", "dest location"],
  weight:      ["weight", "weight (lbs)", "weight lbs", "wt", "lbs", "pounds"],
  pieces:      ["pieces", "qty", "quantity", "units", "pcs", "count"],
  commodity:   ["commodity", "product", "freight", "description"],
  readyDate:   ["ready date", "ready", "pickup date", "pickup_date", "readydate"],
  dueDate:     ["due date", "due", "delivery date", "delivery_date", "duedate"],
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

  return {
    customer:    String(f.customer    || "").trim(),
    origin:      String(f.origin      || "").trim(),
    destination: String(f.destination || "").trim(),
    weight:      toNumberOrNull(f.weight),
    pieces:      toNumberOrNull(f.pieces),
    commodity:   f.commodity ? String(f.commodity).trim() : "",
    readyDate:   toIsoDateOrNull(f.readyDate),
    dueDate:     toIsoDateOrNull(f.dueDate),
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
 * Returns `{ created, failed: [{ rowNumber, customer, error }] }`.
 */
export async function bulkImportOrders(analyzed, {
  chunkSize  = 50,
  onProgress = null,
} = {}) {
  const out = { created: 0, failed: [] };
  const queue = (analyzed || []).filter((a) => a.errors.length === 0);
  const total = queue.length;
  if (total === 0) return out;

  for (let i = 0; i < queue.length; i += chunkSize) {
    const slice = queue.slice(i, i + chunkSize);
    try {
      const res = await BulkPlanApi.import(slice.map((a) => a.payload));
      out.created += Number(res?.created || 0);
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

const TEMPLATE_HEADERS = [
  "Customer", "Origin", "Destination", "Weight (lbs)", "Pieces",
  "Commodity", "Ready Date", "Due Date",
];

const TEMPLATE_SAMPLE_ROWS = [
  ["Cisco Systems", "Chicago, IL 60601", "Dallas, TX 75201", 12000, 24, "Network Equipment", "2026-05-10", "2026-05-13"],
  ["Acme Corp",     "Atlanta, GA 30301", "Miami, FL 33101",  4500,  10, "General",            "2026-05-11", "2026-05-15"],
];

/** Trigger a browser download of a starter XLSX template. */
export function downloadOrderTemplate() {
  const aoa = [TEMPLATE_HEADERS, ...TEMPLATE_SAMPLE_ROWS];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Orders");
  XLSX.writeFile(wb, "order_import_template.xlsx");
}
