/**
 * Rate Management Service
 * Handles rate template generation, export, and related utilities.
 *
 * Also owns the MATCH_TYPE enum constants that back the rate
 * record's `match_type` column (introduced in migration 021). All UI
 * components that show / edit match_type MUST import from here —
 * never hard-code the enum strings (Rule 10 §no hardcoded values).
 */

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
