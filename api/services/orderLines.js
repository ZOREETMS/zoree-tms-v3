// api/services/orderLines.js
// ───────────────────────────────────────────────────────────────────────────
// Pure normalization + rollup for `order_lines`. The DB plumbing (Supabase
// fetches, dbUpsert/dbDelete, audit writes) stays in route handlers — this
// module owns the *shape* of a normalized line and the math that aggregates
// a batch into the parent-order rollup. Same separation as
// services/orderMutations.js#apiOrderToDbPatch (pure mapper) vs
// server.js#dbUpsert (DB plumbing).
//
// Originally extracted to power the bulk-plan/import handler (TMS bug #144 —
// "Line Items are not created on import; only weight and pieces are
// displayed"). The existing inline POST /api/orders/:id/lines handler at
// server.js:1304 remains the source of truth for the replace-with-audit
// path; it can adopt these helpers in a follow-up to deduplicate, but that
// refactor is intentionally out of scope here so the bug-fix stays small.
//
// Module surface:
//   normalizeLine(orderId, line, fallbackLineNum) → DB-shaped row
//   buildLines(orderId, rawLines)                 → { lines, line_count,
//                                                     weight, pieces }
//
// Rules baked in (matching the inline handler so behavior is consistent
// regardless of which writer is used):
//   • id is built via buildOrderLineId so upsert(onConflict:'id') stays
//     deterministic — see services/orderLineIds.js for why this matters.
//   • line_num is taken from the input when supplied, otherwise filled
//     with the fallback (typically the 1-based position in the batch).
//   • item_id is soft (nullable) — description can carry the freight
//     description on its own; matches OMS ingest semantics.
//   • unit_value / total_value are populated from the *_weight columns
//     because the inline handler does the same (see comment at
//     server.js:1343-1344). The columns exist on the table but the UI
//     only renders weight today; preserving the existing fill keeps the
//     two writers byte-for-byte equivalent.

const { buildOrderLineId } = require('./orderLineIds');

/**
 * Convert one caller-shaped line into a DB row. Caller may use either
 * snake_case (line_num, qty_ordered, …) or camelCase (lineNum, qtyOrdered,
 * qty, unitWt, totalWt) — both shapes flow in from different paths
 * (the existing UI editor sends snake_case; the import path will send
 * the camelCase variants the parser already produces).
 */
function normalizeLine(orderId, line, fallbackLineNum) {
  const lineNum = Number(line.line_num ?? line.lineNum) || fallbackLineNum || 1;
  const qty     = parseInt(line.qty_ordered ?? line.qtyOrdered ?? line.qty) || 0;
  const unitWt  = parseFloat(line.unit_weight ?? line.unitWeight ?? line.unitWt) || 0;
  // total_weight: prefer an explicit value if the caller provides one,
  // fall back to qty * unit so import sheets that only carry per-unit
  // numbers still produce a populated total. Math.round avoids the
  // 0.1+0.2 float drift on common cases (3 * 1.1 = 3.3000000000000003).
  const totalWtExplicit = parseFloat(line.total_weight ?? line.totalWeight ?? line.totalWt);
  const totalWt = Number.isFinite(totalWtExplicit) && totalWtExplicit > 0
    ? totalWtExplicit
    : Math.round(qty * unitWt * 100) / 100;
  return {
    id:           buildOrderLineId(orderId, lineNum),
    order_id:     orderId,
    line_num:     lineNum,
    // Truthy-chain (||) instead of nullish-coalesce (??) so an empty
    // string itemId coerces to null — matches the existing UI editor
    // at server.js:1338 (`line.item_id || line.itemId || null`). The
    // schema is nullable text; null is the conventional "no item"
    // value, an empty string would round-trip as "the item literally
    // named ''".
    item_id:      line.item_id || line.itemId || null,
    description:  line.description ?? '',
    qty_ordered:  qty,
    unit_weight:  unitWt,
    total_weight: totalWt,
    // Mirror inline handler at server.js:1343-1344. unit_value/total_value
    // exist on the table but the UI does not surface them; populating
    // them with the *_weight values keeps both writers consistent so a
    // future migration that fixes this won't have to reconcile two
    // divergent histories.
    unit_value:   unitWt,
    total_value:  totalWt,
  };
}

/**
 * Take a batch of caller-shaped lines for one order and return the
 * normalized rows + the parent-order rollup totals. Empty rows are
 * dropped silently so a sparse "Line Items" sheet (where every order
 * is followed by blank rows for visual spacing) doesn't persist
 * phantom lines.
 *
 * Explicit `line_num` values are preserved — matches the existing UI
 * editor's POST /api/orders/:id/lines handler at server.js:1337, which
 * also uses `line.line_num || (i + 1)`. Lines without a line_num get a
 * sequential 1..N fallback based on their position in the *cleaned*
 * batch (the `i + 1` argument passed to normalizeLine below). So a
 * sheet that explicitly numbers lines 1/5/9 keeps that numbering; a
 * sheet that leaves Line # blank gets contiguous 1..N.
 */
function buildLines(orderId, rawLines) {
  const cleaned = (rawLines || []).filter((line) => {
    if (!line) return false;
    const desc = String(line.description ?? '').trim();
    const qty  = parseInt(line.qty_ordered ?? line.qtyOrdered ?? line.qty) || 0;
    const item = String(line.item_id ?? line.itemId ?? '').trim();
    // A row is meaningful if ANY of description / qty / item_id is set.
    // Whole-row blanks (Excel padding) drop here.
    return Boolean(desc) || qty > 0 || Boolean(item);
  });
  const lines = cleaned.map((line, i) => normalizeLine(orderId, line, i + 1));
  const weight = lines.reduce((s, l) => s + (l.total_weight || 0), 0);
  const pieces = lines.reduce((s, l) => s + (l.qty_ordered  || 0), 0);
  return {
    lines,
    line_count: lines.length,
    weight:     Math.round(weight * 100) / 100,
    pieces,
  };
}

module.exports = { normalizeLine, buildLines };
