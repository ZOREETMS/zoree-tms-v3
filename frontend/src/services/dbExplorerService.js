/**
 * Execute a SQL-like query against the loaded data tables.
 * In production, this would hit the Supabase REST API directly.
 * For now we query from the in-memory data passed from App.
 */
export function executeQuery(sql, data) {
  const start = performance.now();
  const trimmed = sql.trim().replace(/;$/, "");
  const lower = trimmed.toLowerCase();

  // Parse simple SELECT * FROM <table> queries
  const match = lower.match(/^select\s+.+\s+from\s+(\w+)/);
  if (!match) {
    throw new Error("Only SELECT queries are supported in the client-side explorer.");
  }

  const tableName = match[1];
  const tableMap = {
    orders: data.orders || [],
    shipments: data.shipments || [],
    carriers: data.carriers || [],
    rates: data.rates || [],
    locations: data.locations || [],
    items: data.items || [],
    invoices: data.invoices || [],
    lane_preferences: data.lanePreferences || [],
    packaging_units: data.packagingUnits || [],
  };

  const rows = tableMap[tableName];
  if (!rows) {
    throw new Error(`Table "${tableName}" not found. Available: ${Object.keys(tableMap).join(", ")}`);
  }

  let result = [...rows];

  // Handle WHERE clause (simple single condition)
  const whereMatch = lower.match(/where\s+(\w+)\s*=\s*'([^']+)'/);
  if (whereMatch) {
    const [, col, val] = whereMatch;
    result = result.filter((r) => String(r[col]).toLowerCase() === val.toLowerCase());
  }

  // Handle ORDER BY
  const orderMatch = lower.match(/order\s+by\s+(\w+)(?:\s+(asc|desc))?/);
  if (orderMatch) {
    const [, col, dir] = orderMatch;
    result.sort((a, b) => {
      const va = a[col] ?? "";
      const vb = b[col] ?? "";
      const cmp = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb));
      return dir === "desc" ? -cmp : cmp;
    });
  }

  // Handle LIMIT
  const limitMatch = lower.match(/limit\s+(\d+)/);
  if (limitMatch) {
    result = result.slice(0, parseInt(limitMatch[1], 10));
  }

  // Handle GROUP BY (simple aggregation)
  const groupMatch = lower.match(/group\s+by\s+(\w+)/);
  if (groupMatch) {
    const groupCol = groupMatch[1];
    const groups = {};
    for (const row of rows) {
      const key = row[groupCol] ?? "(null)";
      if (!groups[key]) groups[key] = { [groupCol]: key, count: 0 };
      groups[key].count++;

      // Handle SUM aggregates
      const sumMatches = [...lower.matchAll(/sum\((\w+)\)/g)];
      for (const sm of sumMatches) {
        const sumCol = sm[1];
        groups[key][`total_${sumCol}`] = (groups[key][`total_${sumCol}`] || 0) + (parseFloat(row[sumCol]) || 0);
      }
    }
    result = Object.values(groups);
  }

  const duration = performance.now() - start;
  const columns = result.length > 0 ? Object.keys(result[0]) : [];

  return { rows: result, columns, duration: duration.toFixed(1), rowCount: result.length };
}

/**
 * Convert query results to CSV string.
 */
export function exportToCSV(columns, rows) {
  const escape = (val) => {
    const s = String(val ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const header = columns.map(escape).join(",");
  const body = rows.map((row) => columns.map((col) => escape(row[col])).join(",")).join("\n");

  return `${header}\n${body}`;
}

/**
 * Trigger CSV file download.
 */
export function downloadCSV(csvContent, filename) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || `query-${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
