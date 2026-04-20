// ═══════════════════════════════════════════════════════════════════
// Order Lines Audit Service — REQ-02.
//
// Owns the change_history contract for the /api/orders/:id/lines
// replace endpoint. Extracted from api/server.js per CLAUDE_RULES §6
// (no large inline logic blocks) and §1 (modular structure): route
// handlers should delegate domain logic to a service.
//
// Public API:
//
//   snapshotBeforeLinesEdit({ dbSelect, orderId })
//     → { beforeLines, beforeOrder } snapshot taken BEFORE the route
//       mutates. Dependency-injects dbSelect so we don't re-reach into
//       server.js's Supabase helpers. Never throws — returns defaults
//       on failure and logs, because audit must not block the save.
//
//   recordLinesEdit({ history, orderId, beforeLines, afterLines,
//                     beforeOrder, afterOrder, user })
//     → Writes one change_history row per changed line (added/removed/
//       changed) plus field diffs on the parent order's weight/pieces/
//       line_count. All rows share a single timestamp so they collapse
//       into one change-set via historyService.shapeHistoryRows's
//       (action, user, second) bucketing. Never throws.
//
// The `history` module is passed in rather than required here so tests
// can stub it without touching Supabase, and so this file stays free
// of any DB-driver imports.
// ═══════════════════════════════════════════════════════════════════

function summarizeLine(l) {
  if (!l) return '—';
  const item = l.item_id || '—';
  const qty  = l.qty_ordered ?? 0;
  const wt   = l.total_weight ?? 0;
  return `${item} × ${qty} (${wt} lbs)`;
}

function indexByLineNum(arr) {
  const m = new Map();
  for (const l of arr || []) m.set(Number(l.line_num) || 0, l);
  return m;
}

/**
 * Read the current order_lines + parent-order totals so we can diff
 * against the post-replace state. Never throws.
 */
async function snapshotBeforeLinesEdit({ dbSelect, orderId }) {
  try {
    const [bl, bo] = await Promise.all([
      dbSelect(
        'order_lines',
        `select=*&order_id=eq.${encodeURIComponent(orderId)}&order=line_num.asc`,
        null,
      ),
      dbSelect(
        'orders',
        `select=weight,pieces,line_count&id=eq.${encodeURIComponent(orderId)}&limit=1`,
        null,
      ),
    ]);
    return {
      beforeLines: Array.isArray(bl) ? bl : [],
      beforeOrder: Array.isArray(bo) && bo.length ? bo[0] : null,
    };
  } catch (err) {
    console.error('[orderLinesAudit] snapshot failed:', err.message);
    return { beforeLines: [], beforeOrder: null };
  }
}

/**
 * Build + write change_history rows for a lines replace. Each changed
 * line_num produces one `edit` row with field='line_<N>' and a human
 * summary as old/new. The cascading parent-order totals (weight,
 * pieces, line_count) are diffed via recordFieldDiffs so they appear
 * in the same change-set. Never throws.
 */
async function recordLinesEdit({
  history,
  orderId,
  beforeLines,
  afterLines,
  beforeOrder,
  afterOrder,
  user,
}) {
  try {
    const beforeMap = indexByLineNum(beforeLines);
    const afterMap  = indexByLineNum(afterLines);
    const allLineNums = new Set([...beforeMap.keys(), ...afterMap.keys()]);
    const auditTs = new Date().toISOString();

    const lineRows = [];
    for (const ln of [...allLineNums].sort((a, b) => a - b)) {
      const before = beforeMap.get(ln);
      const after  = afterMap.get(ln);
      const bSum = summarizeLine(before);
      const aSum = summarizeLine(after);
      if (bSum === aSum) continue; // unchanged
      lineRows.push(history.buildRow({
        entityType: 'order',
        entityId:   orderId,
        action:     'edit',
        field:      `line_${ln}`,
        before:     bSum,
        after:      aSum,
        user,
        createdAt:  auditTs,
      }));
    }
    if (lineRows.length) await history.recordChangeBatch(lineRows);

    if (beforeOrder && afterOrder) {
      await history.recordFieldDiffs({
        entityType: 'order',
        entityId:   orderId,
        before:     beforeOrder,
        after:      afterOrder,
        user,
        fields:     { weight: 'weight', pieces: 'pieces', line_count: 'lineCount' },
      });
    }
  } catch (err) {
    console.error('[orderLinesAudit] recordLinesEdit failed:', err.message);
  }
}

module.exports = {
  snapshotBeforeLinesEdit,
  recordLinesEdit,
  // exported for unit tests
  _internal: { summarizeLine, indexByLineNum },
};
