// ════════════════════════════════════════════════════════════════════
// orderDetailSyncSignature — pure helper for useOrderDetailLiveSync.
//
// Why this is a separate module
// ─────────────────────────────
// mobile/jest.config.js sets testEnvironment: 'node' and does not load
// the React Native preset (per the comment at the top of that file:
// "Component / screen tests are intentionally not configured here
// yet"). Importing 'react-native' from a test would therefore blow up
// at parse time on RN's flow-typed index.js.
//
// Splitting the pure derivation into its own file keeps the hook (which
// must import react + react-native) RN-only while the testable helper
// stays in plain TypeScript with no transitive RN deps. Same separation
// pattern used by services/orderDetailService.ts vs. the screen.
// ════════════════════════════════════════════════════════════════════

/**
 * Build a stable signature string for the given order. The signature
 * changes whenever the order is meaningfully modified, so callers can
 * use it to know when to refetch detail-only data.
 *
 * Strategy:
 *   1. Prefer `updatedAt` (or snake_case `updated_at`) because every
 *      server PATCH on the orders table bumps the column via the
 *      table's BEFORE UPDATE trigger. This is the canonical
 *      "the row changed" signal and is monotonically increasing.
 *   2. Fall back to a small composite of the fields that are most
 *      likely to change on web edits when `updated_at` is missing
 *      (legacy inline server.js routes that returned older shapes).
 *      JSON.stringify with a fixed key order produces a stable string
 *      that's safe for diff-by-equality.
 *   3. Empty string when the order is not yet loaded or the id is
 *      "new" — caller should treat this as "no live sync needed".
 */
export function getOrderSyncSignature(
  orders: ReadonlyArray<any> | null | undefined,
  orderId: string | null | undefined,
): string {
  if (!orderId || orderId === 'new') return '';
  if (!Array.isArray(orders)) return '';

  const idStr = String(orderId);
  const order = orders.find((row) => {
    const rid = row?.id ?? row?.order_id;
    return rid != null && String(rid) === idStr;
  });
  if (!order) return '';

  // Primary signal: server-managed updated_at column. Bumped by every
  // PATCH (status change, header edit, line-edit cascade) so a string
  // change here is a faithful proxy for "something changed on the
  // server side that the user must see".
  const updatedAt = order.updatedAt ?? order.updated_at ?? null;
  if (updatedAt) return `u:${String(updatedAt)}`;

  // Fallback composite. Only reached on legacy payloads that omit
  // updated_at. Fixed key order keeps the JSON deterministic across
  // Node and Hermes engines.
  return JSON.stringify({
    s: order.status ?? null,
    w: order.weight ?? null,
    p: order.pieces ?? null,
    lc: order.line_count ?? order.lineCount ?? null,
    sm: order.shipMode ?? order.ship_mode ?? null,
    sl: order.serviceLevel ?? order.service_level ?? null,
    sf: order.shipFromName ?? order.ship_from_name ?? null,
    st: order.shipToName ?? order.ship_to_name ?? null,
    cm: order.commodity ?? null,
    cu: order.customer ?? null,
    rd: order.readyDate ?? order.ready ?? null,
    dd: order.dueDate ?? order.due ?? null,
    sh: order.shipmentId ?? order.shipment_id ?? null,
    nt: order.notes ?? null,
  });
}
