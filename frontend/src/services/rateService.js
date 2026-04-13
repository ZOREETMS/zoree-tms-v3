/**
 * Rate Management Service
 * Handles rate template generation, export, and related utilities.
 */

const RATE_TEMPLATE_COLUMNS = [
  { header: "Lane ID", example: "CHI-LAX-001" },
  { header: "Origin City", example: "Chicago" },
  { header: "Origin State", example: "IL" },
  { header: "Origin ZIP", example: "60601" },
  { header: "Destination City", example: "Los Angeles" },
  { header: "Destination State", example: "CA" },
  { header: "Destination ZIP", example: "90001" },
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
    csvRows.push(
      [
        r.lane,
        r.origin?.split(",")[0]?.trim() || "",
        r.origin?.split(",")[1]?.trim() || "",
        r.origin?.split(",")[2]?.trim() || "",
        r.dest?.split(",")[0]?.trim() || "",
        r.dest?.split(",")[1]?.trim() || "",
        r.dest?.split(",")[2]?.trim() || "",
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
