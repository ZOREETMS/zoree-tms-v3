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

/* ── CzarLite applicability ──────────────────────────────────────
 * CzarLite is an LTL-tariff concept (class). The Edit Rate modal
 * already gates CzarLite columns on mode === 'LTL'; UI surfaces
 * (badge, stats counter, "CzarLite only" filter, row highlight on
 * the rate-management table) must do the same so a carrier-level
 * `czarlite_enabled` flag — set legitimately for the carrier's LTL
 * business — does not bleed CzarLite styling into TL/Flatbed/
 * Intermodal/Drayage rate rows.
 *
 * Single source of truth: change the rule here, never inline the
 * mode comparison in components.
 */

/** True when `mode` is the LTL mode that uses CzarLite tariffs. */
export function isLtlMode(mode) {
  return String(mode || "").trim().toUpperCase() === "LTL";
}

/**
 * True when CzarLite styling/columns should be shown for this rate.
 * Combines mode (LTL-only) with the rate-level `czarlite` flag and an
 * optional carrier-level `czarlite_enabled` fallback.
 *
 * @param {Object} rate              - rate row
 * @param {Array<Object>} [carriers] - full carriers list (for fallback)
 * @returns {boolean}
 */
export function isCzarLiteApplicable(rate, carriers = []) {
  if (!rate) return false;
  if (!isLtlMode(rate.mode)) return false;
  if (rate.czarlite === true) return true;
  return (carriers || []).some(
    (c) => c && c.name === rate.carrier && c.czarlite_enabled === true
  );
}

/* ── Rate management page helpers ─────────────────────────────
 * The rate-management grid renders a "lane ID" derived from the
 * `lane` column plus the expiry date, and the search box on that
 * page filters against the same string. Keeping both the format
 * and the matcher in this service is the single source of truth
 * — change the convention here, never reimplement it inline.
 */

/**
 * Build the displayed lane identifier — the rate's `lane` with its
 * expiry date (YYYYMMDD) appended when not already present. Idempotent
 * when the suffix is already there (mirrors the table render and the
 * EditRateModal `appendExpirySuffix` logic).
 *
 * @param {Object} rate - rate row (may use snake_case or camelCase aliases)
 * @returns {string}
 */
export function buildRateLaneId(rate) {
  if (!rate) return "";
  let lane = rate.lane || "";
  const exp = rate.exp || rate.expires || rate.expiry_date || rate.expiryDate || "";
  if (exp && !lane.includes(String(exp).replace(/-/g, ""))) {
    lane += "-" + String(exp).replace(/-/g, "");
  }
  return lane;
}

/**
 * Parse the rate-management search-box query into discrete tokens.
 * Commas separate tokens with OR semantics so users can paste several
 * lane IDs at once — e.g.
 *   "AVRT-ATL-DAL-LTL-CZ-STD-20261231,AVRT-ATL-HOU-LTL-CZ-STD-20261231"
 * Tokens are lowercased, trimmed, de-duplicated; empty/blank inputs
 * return an empty array.
 *
 * @param {string} query
 * @returns {string[]}
 */
export function parseRateSearchQuery(query) {
  if (query == null) return [];
  const seen = new Set();
  const out = [];
  for (const raw of String(query).split(",")) {
    const t = raw.trim().toLowerCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * True when a rate row matches the supplied free-text query. Each
 * comma-separated token is matched independently against the lane
 * id, origin, destination, carrier, mode, status, and unit fields;
 * a row matches when any token finds a substring hit on any field
 * (OR-of-OR). Empty queries match every row.
 *
 * @param {Object} rate
 * @param {string} query
 * @returns {boolean}
 */
export function rateMatchesSearch(rate, query) {
  const tokens = parseRateSearchQuery(query);
  if (tokens.length === 0) return true;
  if (!rate) return false;
  const fields = [
    buildRateLaneId(rate),
    rate.origin || "",
    rate.dest || rate.destination || "",
    rate.carrier || "",
    rate.mode || "",
    rate.status || "",
    rate.unit || "",
  ].map((v) => String(v || "").toLowerCase());
  // Per-field substring match — mirrors the original .some() semantics
  // so a token cannot accidentally span two adjacent fields.
  return tokens.some((t) => fields.some((f) => f.includes(t)));
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
 * Case-insensitive, whitespace-tolerant string key used for carrier /
 * lane matching. Mirrors the inline `normalize` used by the CBOL
 * planner in ordersService.js so both paths match consistently.
 */
function normalizeKey(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Find the first rate in `rates` that matches a given lane triple
 * (carrier + origin + destination). Matching is the same fuzzy-substring
 * logic already used by the CBOL planner — either side containing the
 * other counts as a match.
 *
 * Used by shipment-creation paths (ZoreeAI `PLAN_ORDER`, CBOL, etc.) to
 * copy rate-scoped fields — notably `equipment` (migration 025) and
 * `rate_id` — onto the new shipment. Returns `null` when no rate
 * matches; callers should fall back to `null` equipment, not invent one.
 *
 * @param {Array<Object>} rates   - Full rates list from TMS data.
 * @param {Object} lane
 * @param {string} lane.carrier   - Carrier name (e.g. "Averitt Express").
 * @param {string} lane.origin    - Origin city/location string.
 * @param {string} lane.dest      - Destination city/location string.
 * @returns {Object|null} matching rate row, or null.
 */
export function findMatchingRate(rates, { carrier, origin, dest } = {}) {
  if (!Array.isArray(rates) || rates.length === 0) return null;
  const cNorm = normalizeKey(carrier);
  const oNorm = normalizeKey(origin);
  const dNorm = normalizeKey(dest);
  if (!cNorm || !oNorm || !dNorm) return null;

  return (
    rates.find((r) => {
      const rc = normalizeKey(r.carrier);
      const ro = normalizeKey(r.origin);
      const rd = normalizeKey(r.dest || r.destination);
      return (
        (rc.includes(cNorm) || cNorm.includes(rc)) &&
        (ro.includes(oNorm) || oNorm.includes(ro)) &&
        (rd.includes(dNorm) || dNorm.includes(rd))
      );
    }) || null
  );
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

/**
 * Canonical service-level set. Single source of truth for both the
 * EditRateModal dropdown and the rate-upload normalizer (CLAUDE_RULES
 * §10 — no hardcoded values per UI). When a row is imported with
 * "EXPRESS" or "express", the upload service title-cases it back to
 * one of these so the modal dropdown can round-trip the value.
 */
export const SERVICE_LEVEL_OPTIONS = ["Standard", "Express", "Expedited", "Economy"];

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
  // Migration 024 added rates.equipment as a soft-FK to equipment_types.name.
  // Keep this column in the template so the same field round-trips through
  // download → fill in → upload (and through export of existing rates).
  { header: "Equipment", example: "Dry Van 53ft" },
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
        r.equipment || "",
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
