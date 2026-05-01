/**
 * Pure Excel export utility — no entity knowledge, no UI.
 * Wraps `xlsx` so callers don't depend on the library directly.
 *
 * Usage:
 *   writeRowsToExcel({
 *     rows:     filteredRows,                 // array of plain objects
 *     columns:  [{ header: "Order ID", accessor: "id" }, ...],
 *     sheetName: "Orders",
 *     filename:  "zoree_orders_2026-05-01.xlsx",
 *   });
 *
 * `accessor` may be a string (key on the row) or a function (row) => value.
 */

import * as XLSX from "xlsx";

function resolveValue(row, accessor) {
  if (typeof accessor === "function") return accessor(row);
  return row?.[accessor];
}

function rowsToAOA(rows, columns) {
  const headerRow = columns.map((c) => c.header);
  const dataRows = rows.map((row) =>
    columns.map((c) => {
      const v = resolveValue(row, c.accessor);
      if (v === null || v === undefined) return "";
      // Keep numbers/dates as-is so Excel detects them; everything else stringified.
      if (typeof v === "number" || v instanceof Date) return v;
      if (typeof v === "object") return JSON.stringify(v);
      return v;
    })
  );
  return [headerRow, ...dataRows];
}

export function writeRowsToExcel({ rows, columns, sheetName = "Sheet1", filename }) {
  if (!Array.isArray(rows)) throw new Error("writeRowsToExcel: rows must be an array");
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error("writeRowsToExcel: columns must be a non-empty array");
  }
  if (!filename) throw new Error("writeRowsToExcel: filename is required");

  const aoa = rowsToAOA(rows, columns);
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  XLSX.writeFile(workbook, filename);
}
