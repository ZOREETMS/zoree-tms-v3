/**
 * Rate Management Service
 * Handles rate template generation, export, and related utilities.
 *
 * Also owns the MATCH_TYPE enum constants that back the rate
 * record's `match_type` column (introduced in migration 021). All UI
 * components that show / edit match_type MUST import from here —
 * never hard-code the enum strings (Rule 10 §no hardcoded values).
 */

import { DbApi } from "../lib/api";

/* ── match_type: single source of truth for the UI layer ─────────
 * Mirrors api/services/ltlRateMatcher.js MATCH_TYPES. Kept in sync
 * manually; a future shared/types package could own both.
 */
export const MATCH_TYPE_VALUES = Object.freeze({
  CITY:    "city_to_city",
  ZIP:     "zip_to_zip",
  COUNTRY: "country_to_country",
});

export const MATCH_TYPE_OPTIONS = [
  {
    value: MATCH_TYPE_VALUES.CITY,
    label: "City to City",
    hint:  "Match origin & destination city names (case-insensitive)",
  },
  {
    value: MATCH_TYPE_VALUES.ZIP,
    label: "Zip to Zip",
    hint:  "Match origin & destination 5-digit ZIP codes exactly",
  },
  {
    value: MATCH_TYPE_VALUES.COUNTRY,
    label: "Country to Country",
    hint:  "Match origin & destination country codes only (city/zip ignored)",
  },
];

/** Normalize an arbitrary match_type value to a canonical enum member. */
export function normalizeMatchType(value) {
  if (!value) return MATCH_TYPE_VALUES.CITY;
  const v = String(value).trim().toLowerCase().replace(/-/g, "_");
  if (v === MATCH_TYPE_VALUES.ZIP)     return MATCH_TYPE_VALUES.ZIP;
  if (v === MATCH_TYPE_VALUES.COUNTRY) return MATCH_TYPE_VALUES.COUNTRY;
  return MATCH_TYPE_VALUES.CITY;
}

/** Human-readable label for a match_type (for chips, columns, etc). */
export function getMatchTypeLabel(value) {
  const norm = normalizeMatchType(value);
  const opt  = MATCH_TYPE_OPTIONS.find((o) => o.value === norm);
  return opt ? opt.label : "City to City";
}

/** Short badge text (≤4 chars) for dense table rendering. */
export function getMatchTypeBadge(value) {
  const norm = normalizeMatchType(value);
  if (norm === MATCH_TYPE_VALUES.ZIP)     return "ZIP";
  if (norm === MATCH_TYPE_VALUES.COUNTRY) return "CTRY";
  return "CITY";
}

/* ── Rate lookup ──────────────────────────────────────────────
 * Rates are shared across every planning surface (bulk plan, route
 * optimizer, rate-management). Shipment rows store only the rate_id /
 * lane reference — discount %, discount $, and FSC % live in the
 * rates table. Views that want to display "how was this shipment
 * priced" must look up the rate at render time through this service.
 */

/**
 * Fetch a single rate row by its `lane` identifier (the value stored
 * in shipments.rate_id). Returns the first matching row or null when
 * no match is found. Errors are swallowed and logged — a missing rate
 * is not fatal to the caller (e.g. shipment detail still renders).
 */
export async function getRateByLane(lane) {
  const key = String(lane || "").trim();
  if (!key) return null;
  try {
    const rows = await DbApi.query("rates", `select=*&lane=eq.${key}&limit=1`);
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch (e) {
    console.warn("[rateService] getRateByLane failed:", e?.message || e);
    return null;
  }
}

/**
 * Extract the (possibly blended) discount info from a rate row into
 * the shape the UI actually renders. Normalizes the legacy `discount`
 * / `discount_pct` and `discount_flat` / `discount_amt` aliases, and
 * computes the money value of the % discount against a supplied base.
 */
export function summarizeDiscount(rate, baseAmount = 0) {
  if (!rate) return { pct: 0, flat: 0, amount: 0, hasDiscount: false };
  const pct = Number(rate.discount ?? rate.discount_pct ?? 0) || 0;
  const flat = Number(rate.discount_flat ?? rate.discount_amt ?? 0) || 0;
  const amount = Math.round((Number(baseAmount) || 0) * pct / 100) + flat;
  return {
    pct,
    flat,
    amount,
    hasDiscount: pct > 0 || flat > 0,
  };
}

/* ── Rate mutations ────────────────────────────────────────────
 * Writes go through DbApi so the UI layer never builds a fetch URL
 * itself (CLAUDE_RULES §4 — services layer owns the API contract).
 */

/**
 * Delete a rate by its row id. Throws on failure so the caller can
 * surface a toast; returns nothing meaningful on success.
 */
export async function deleteRate(id) {
  if (!id) throw new Error("deleteRate: id is required");
  return DbApi.remove("rates", id);
}

/**
 * Duplicate an existing rate row. Client-side clone: strips the id
 * and any server-managed timestamps, appends " (COPY)" to the lane
 * so the new row is distinguishable in the grid, then upserts via
 * the existing create path. No new API endpoint required.
 *
 * Returns the API response (the inserted row).
 */
export async function duplicateRate(rate) {
  if (!rate || typeof rate !== "object") {
    throw new Error("duplicateRate: rate object is required");
  }
  const clone = { ...rate };
  delete clone.id;
  delete clone.created_at;
  delete clone.updated_at;
  const baseLane = String(rate.lane || "").trim() || "NEW-LANE";
  clone.lane = `${baseLane} (COPY)`;
  return DbApi.upsert("rates", clone);
}

/* ── CSV template / export ──────────────────────────────────── */

const RATE_TEMPLATE_COLUMNS = [
  { header: "Lane ID", example: "CHI-LAX-001" },
  { header: "Match Type", example: "city_to_city" },
  { header: "Origin City", example: "Chicago" },
  { header: "Origin State", example: "IL" },
  { header: "Origin ZIP", example: "60601" },
  { header: "Origin Country", example: "USA" },
  { header: "Destination City", example: "Los Angeles" },
  { header: "Destination State", example: "CA" },
  { header: "Destination ZIP", example: "90001" },
  { header: "Destination Country", example: "USA" },
  { header: "Carrier", example: "XPO Logistics" },
  { header: "Mode", example: "TL" },
  { header: "Rate", example: "2500.00" },
  { header: "Rate Unit", example: "flat" },
  { header: "FSC %", example: "18.5" },
  { header: "Discount %", example: "5" },
  { header: "Discount $ (Flat)", example: "0" },
  { header: "Effective Date", example: "2026-04-15" },
  { header: "Expiry Date", example: "2026-12-31" },
  { header: "Status", example: "Active" },
  { header: "Service Level", example: "Standard" },
  { header: "Transit Days", example: "3" },
  { header: "Miles", example: "2015" },
  { header: "CzarLite (Y/N)", example: "N" },
  { header: "CzarLite Freight Class", example: "" },
  { header: "CzarLite Min Weight", example: "" },
  { header: "CzarLite Max Weight", example: "" },
];

function escapeCSVField(value) {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generate and download a CSV template for bulk rate uploads.
 * Includes a header row and one example row to guide the user.
 */
export function downloadRateTemplate() {
  const headers = RATE_TEMPLATE_COLUMNS.map((c) => c.header);
  const exampleRow = RATE_TEMPLATE_COLUMNS.map((c) => escapeCSVField(c.example));

  const csvContent = [headers.join(","), exampleRow.join(",")].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "rate_upload_template.csv";
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Export current rates data as CSV.
 */
export function exportRatesCSV(rates) {
  if (!rates || rates.length === 0) return false;

  const headers = RATE_TEMPLATE_COLUMNS.map((c) => c.header);
  const csvRows = [headers.join(",")];

  rates.forEach((r) => {
    // Prefer structured columns (origin_zip / origin_country) added in
    // migration 021; fall back to the legacy free-text parsing so older
    // rows without structured fields still export sanely.
    const originParts = (r.origin || "").split(",");
    const destParts   = (r.dest   || "").split(",");
    csvRows.push(
      [
        r.lane,
        normalizeMatchType(r.match_type),
        originParts[0]?.trim() || "",
        originParts[1]?.trim() || "",
        r.origin_zip || originParts[2]?.trim() || "",
        r.origin_country || "USA",
        destParts[0]?.trim() || "",
        destParts[1]?.trim() || "",
        r.dest_zip || destParts[2]?.trim() || "",
        r.dest_country || "USA",
        r.carrier,
        r.mode,
        r.rate,
        r.unit,
        r.fsc,
        r.discount,
        r.discount_flat,
        r.eff,
        r.exp,
        r.status,
        r.service_level,
        r.transit_days,
        r.miles,
        r.czarlite ? "Y" : "N",
        r.czarlite_class,
        r.czarlite_min_wt,
        r.czarlite_max_wt,
      ]
        .map(escapeCSVField)
        .join(",")
    );
  });

  const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "rates_export.csv";
  link.click();
  URL.revokeObjectURL(url);
  return true;
}
