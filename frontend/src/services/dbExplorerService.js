/**
 * Execute a SQL-like query against the loaded data tables.
 * In production, this would hit the Supabase REST API directly.
 * For now we query from the in-memory data passed from App.
 *
 * Table catalog lives in ./dbExplorerCatalog so this module stays
 * focused on parsing/executing the query (Rule 6 — services-first,
 * no mega-modules).
 */
import { resolveTable, listTables, getDefaultOrderFor } from "./dbExplorerCatalog";

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
  const rows = resolveTable(tableName, data);
  if (rows === null) {
    throw new Error(
      `Table "${tableName}" not found. Available: ${listTables().join(", ")}`
    );
  }

  let result = [...rows];

  // Handle WHERE clause (simple single condition: =, !=, <>, LIKE, ILIKE, NOT LIKE)
  const whereLikeMatch = lower.match(/where\s+(\w+)\s+(not\s+like|like|ilike)\s+'([^']+)'/);
  const whereEqMatch = lower.match(/where\s+(\w+)\s*(!=|<>|=)\s*'([^']+)'/);
  if (whereLikeMatch) {
    const [, col, op, pattern] = whereLikeMatch;
    // Convert SQL LIKE pattern to regex: % -> .*, _ -> .
    const regexStr = "^" + pattern.replace(/%/g, ".*").replace(/_/g, ".") + "$";
    const regex = new RegExp(regexStr, "i");
    const negate = op.includes("not");
    result = result.filter((r) => {
      const matches = regex.test(String(r[col] ?? ""));
      return negate ? !matches : matches;
    });
  } else if (whereEqMatch) {
    const [, col, op, val] = whereEqMatch;
    result = result.filter((r) => {
      const eq = String(r[col]).toLowerCase() === val.toLowerCase();
      return op === "=" ? eq : !eq;
    });
  }

  // Handle ORDER BY (explicit). When omitted, QA #306 — DB Explorer's
  // shipments view was returning rows in API load-order (created_at
  // desc) while the TMS Shipments page sorts by id, so the two views
  // never matched. Default to ascending id sort to align with the
  // typical "1, 2, 3, 4…" expectation when the user just runs
  // SELECT * FROM <table> without specifying an order.
  //
  // QA #313 — that generic id fallback diverges from any TMS page that
  // orders by something other than id (the Planning Parameters page
  // requests ?order=category.asc). Check the catalog for a per-table
  // override first, and only fall through to the id sort when no
  // override is registered.
  const orderMatch = lower.match(/order\s+by\s+(\w+)(?:\s+(asc|desc))?/);
  if (orderMatch) {
    const [, col, dir] = orderMatch;
    result.sort((a, b) => {
      const va = a[col] ?? "";
      const vb = b[col] ?? "";
      const cmp = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb));
      return dir === "desc" ? -cmp : cmp;
    });
  } else {
    const catalogOrder = getDefaultOrderFor(tableName);
    if (catalogOrder && result.length > 0) {
      const { col, dir } = catalogOrder;
      result.sort((a, b) => {
        const va = a[col] ?? "";
        const vb = b[col] ?? "";
        const cmp = typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb), undefined, { numeric: true });
        return dir === "desc" ? -cmp : cmp;
      });
    } else if (result.length > 0 && Object.prototype.hasOwnProperty.call(result[0], "id")) {
      result.sort((a, b) => {
        const va = a.id ?? "";
        const vb = b.id ?? "";
        // Numeric ids compare numerically; everything else falls back to
        // locale-aware string compare (ids like "SHP-00012" sort correctly).
        if (typeof va === "number" && typeof vb === "number") return va - vb;
        return String(va).localeCompare(String(vb), undefined, { numeric: true });
      });
    }
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
