/* UNUSED as of 2026-09-10. The Orders-page bulk action was changed from
 * "Unassign + Delete" to plain "Unassign" (orders return to Unplanned and
 * empty shipments are removed; the orders are never deleted), so nothing
 * imports this module any more. Kept rather than deleted in case bulk
 * order deletion is wanted back as its own button — wire it to a button
 * of its own, don't fold it into Unassign.
 */
/* ═══════════════════════════════════════════════════════════════════
 * Bulk Unassign + Delete — frontend/src/services/bulkDeleteService.js
 * ─────────────────────────────────────────────────────────────────────
 * Detaches selected orders from their shipments, then deletes the orders
 * permanently. Two phases, in that order, and the order matters:
 *
 *   1. Unassign — clears shipment_id / status via the audited unplan path
 *      and removes shipments left empty. Deleting an order while a
 *      shipment still lists it in `order_ids` leaves that shipment
 *      pointing at a row that no longer exists, and every screen that
 *      resolves a shipment's orders then renders a gap or throws.
 *   2. Delete — OrdersApi.remove per order, so the backend writes its
 *      'delete' change-history row. A direct DB delete skips the audit.
 *
 * THIS IS NOT REVERSIBLE. There is no soft-delete or trash on orders:
 * once removed, the row and its history are gone. Callers must confirm
 * with the user before invoking, and must show the real count.
 *
 * Deliberately has no "delete everything" mode: it operates only on an
 * explicit list of ids the user selected. A filter-based bulk delete is
 * one careless filter away from emptying the table.
 * ═══════════════════════════════════════════════════════════════════ */

import { OrdersApi } from "../lib/api";
import { unplanAll } from "./bulkUnplanService";

/** Statuses where freight is already committed to a carrier. */
export const PROTECTED_STATUSES = Object.freeze([
  "Tendered", "Tender Accepted", "Shipped", "In Transit", "Delivered",
]);

/**
 * Split a selection into what may be deleted and what must not be.
 *
 * A tendered or in-transit order represents a commitment to a carrier and
 * a physical load in motion; deleting it destroys the record while the
 * freight still exists. Those are refused here and reported back so the
 * UI can say why, rather than being silently skipped.
 */
export function partitionForDelete(orders, selectedIds) {
  const ids = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  const deletable = [];
  const blocked = [];
  for (const o of orders || []) {
    if (!o || !ids.has(o.id)) continue;
    if (PROTECTED_STATUSES.includes(o.status)) blocked.push(o);
    else deletable.push(o);
  }
  return { deletable, blocked };
}

/**
 * Unassign then delete.
 *
 * @param {object[]} orders      full orders list (for shipment lookups)
 * @param {object[]} shipments   full shipments list
 * @param {Set<string>|string[]} selectedIds
 * @param {{onProgress?:(done:number,total:number,phase:string)=>void, concurrency?:number}} [opts]
 * @returns {Promise<{unassigned:string[], deleted:string[], deletedShipments:string[],
 *                    blocked:{id:string,status:string}[], failed:{id:string,error:string}[]}>}
 */
export async function unassignAndDelete(orders, shipments, selectedIds, opts = {}) {
  const { onProgress, concurrency = 12 } = opts;
  const { deletable, blocked } = partitionForDelete(orders, selectedIds);
  const targetIds = new Set(deletable.map((o) => o.id));

  const failed = [];
  const deleted = [];

  // ── Phase 1: unassign, reusing the shipment-aware bulk unplanner so
  // whole-shipment groups skip the per-order order_ids rewrites and
  // emptied shipments (and their MBOL) are cleaned up once.
  let unassigned = [];
  let deletedShipments = [];
  try {
    const res = await unplanAll(orders, shipments, {
      filter: (o) => targetIds.has(o.id),
      concurrency,
      onProgress: (done, total) => onProgress && onProgress(done, total, "unassign"),
    });
    unassigned = res.unplanned;
    deletedShipments = res.deletedShipments;
    failed.push(...res.failed);
  } catch (err) {
    // Phase 1 failing wholesale must not fall through into deletion:
    // deleting orders still attached to shipments is the exact corruption
    // this function exists to avoid.
    return { unassigned: [], deleted: [], deletedShipments: [], blocked, failed: [{ id: "*", error: `unassign failed, nothing deleted: ${err.message}` }] };
  }

  // ── Phase 2: delete. Skip anything phase 1 could not detach — an order
  // still holding a shipment_id is exactly the row we must not remove.
  const failedIds = new Set(failed.map((f) => f.id));
  const toDelete = deletable.filter((o) => !failedIds.has(o.id));

  let done = 0;
  for (let i = 0; i < toDelete.length; i += concurrency) {
    const batch = toDelete.slice(i, i + concurrency);
    // eslint-disable-next-line no-await-in-loop
    const res = await Promise.allSettled(batch.map((o) => OrdersApi.remove(o.id)));
    res.forEach((r, idx) => {
      if (r.status === "fulfilled") deleted.push(batch[idx].id);
      else failed.push({ id: batch[idx].id, error: (r.reason && r.reason.message) || String(r.reason) });
    });
    done += batch.length;
    if (onProgress) onProgress(done, toDelete.length, "delete");
  }

  return { unassigned, deleted, deletedShipments, blocked: blocked.map((o) => ({ id: o.id, status: o.status })), failed };
}

/** One-line summary for a toast. */
export function summarizeDelete(result) {
  if (!result) return "Nothing deleted.";
  const bits = [`Deleted ${result.deleted.length} order(s)`];
  if (result.deletedShipments.length) bits.push(`${result.deletedShipments.length} shipment(s) removed`);
  if (result.blocked.length) bits.push(`${result.blocked.length} skipped (tendered or later)`);
  if (result.failed.length) bits.push(`${result.failed.length} failed`);
  return bits.join(" · ");
}
