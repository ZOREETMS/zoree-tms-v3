// ---------------------------------------------------------------------------
// frontend/src/services/omsSyncStatusService.js
// Service layer for the Shipments page OMS-sync pill. Reads only the columns
// the pill needs from oms_orders, scoped to the shipment ids currently in
// view. No UI imports — this module returns plain data structures.
//
// Contract:
//   fetchOmsSyncForShipmentIds(ids: string[])
//     → Promise<Map<tmsShipmentId: string, oms_orders_rows: Array<{
//         id, tms_shipment_id, tms_ship_status_pushed_at,
//         tms_order_pushed_at, tendered_at
//       }>>>
//
//   groupOmsOrdersByShipmentId(rows)  — pure helper, exported for testing.
//
// All DB access flows through the `/api/db/oms_orders` proxy (ALLOWED list in
// api/server.js line 224), via DbApi.query from src/lib/api.js — no direct
// fetch from this module, no URL construction in views. CLAUDE_RULES §4.
// ---------------------------------------------------------------------------

import { DbApi } from "../lib/api";

/**
 * Group oms_orders rows by their tms_shipment_id. Pure.
 * @param {Array<Object>} rows
 * @returns {Map<string, Array<Object>>}
 */
export function groupOmsOrdersByShipmentId(rows) {
  const m = new Map();
  (rows || []).forEach((r) => {
    const sid = r.tms_shipment_id;
    if (!sid) return;
    const key = String(sid);
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(r);
  });
  return m;
}

/**
 * Build the PostgREST-style `in.(...)` filter value. Supabase's /api/db proxy
 * passes query params through verbatim, so the list must be comma-joined and
 * each id must be safe for a URL component.
 * @param {string[]} ids
 * @returns {string}
 */
function buildInFilter(ids) {
  const clean = (ids || [])
    .filter(Boolean)
    .map((id) => String(id).replace(/[(),]/g, "")); // defensive: strip chars that break PostgREST's in() syntax
  return `(${clean.join(",")})`;
}

/**
 * Fetch the oms_orders rows linked to any of the given TMS shipment ids, and
 * group them by tms_shipment_id.
 *
 * Returns an empty Map when `ids` is empty — does not hit the network.
 *
 * @param {string[]} ids
 * @returns {Promise<Map<string, Array<Object>>>}
 */
export async function fetchOmsSyncForShipmentIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return new Map();

  const select = [
    "id",
    "tms_shipment_id",
    "tms_ship_status_pushed_at",
    "tms_order_pushed_at",
    "tendered_at",
  ].join(",");

  const query = `select=${select}&tms_shipment_id=in.${buildInFilter(ids)}&limit=2000`;

  try {
    const rows = await DbApi.query("oms_orders", query);
    return groupOmsOrdersByShipmentId(rows);
  } catch (err) {
    // Non-fatal for the pill — log and return an empty map so the UI falls
    // back to "na" for every shipment rather than breaking the page.
    // Common cause: migration 023 not applied (column does not exist on
    // oms_orders). The server log will carry the real reason.
    // eslint-disable-next-line no-console
    console.warn("[omsSyncStatusService] fetch failed:", err?.message || err);
    return new Map();
  }
}
