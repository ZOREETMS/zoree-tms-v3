/**
 * Format a timestamp into a relative time string (e.g., "3h ago", "Just now").
 */
export function formatTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;

  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Format a currency number for KPI / dashboard chips where a compact
 * abbreviation is desirable (e.g. 284000 → "$284K", 6961 → "$7K").
 *
 * QA bug #128 caveat: this abbreviation is appropriate for headline KPIs
 * on the dashboard but NOT for line-item shipment costs displayed
 * alongside the web TMS, which shows full precision. Use
 * `formatCurrencyFull` for shipment cost display so a $6,961 shipment
 * doesn't render as "$7K" on mobile while the web shows "$6,961".
 */
export function formatCurrency(n) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}K`;
  return `$${Math.round(n)}`;
}

/**
 * Full-precision currency formatter for line-item display (per-shipment
 * cost, per-invoice amount). Mirrors how the web TMS renders the same
 * numbers (`Number(x).toLocaleString(...)` with two decimals) so a
 * shipment opened on both surfaces shows an identical figure. QA bug
 * #128: web $6,961.00 vs mobile $7K diverged because the shipment list
 * was using the abbreviated `formatCurrency` above.
 *
 * Negative numbers and non-finite values render as "$0.00" rather than
 * leaking "$NaN" into the UI on a partially-loaded shipment row.
 */
export function formatCurrencyFull(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return "$0.00";
  return `$${num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format a cell value for table display.
 */
export function formatCell(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
