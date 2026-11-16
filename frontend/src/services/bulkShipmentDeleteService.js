/**
 * Bulk "Unassign + Delete" for the Shipments page.
 *
 * Semantics (deliberately different from the Orders-page button of the same
 * name): the SHIPMENTS selected are deleted; their linked ORDERS are only
 * unassigned — they drop back to Unplanned and remain in the system.
 *
 * Why this does NOT call unplanOrdersForShipmentRemoval
 * ─────────────────────────────────────────────────────
 * DELETE /api/shipments/:id (server.js) already cascades: it reads the
 * linked orders, bulk-PATCHes every one of them to
 * { shipment_id: null, status: 'Unplanned' } in a SINGLE PostgREST
 * request, writes the per-order 'unassign' change_history rows, and then
 * deletes the shipment. Cost: 4 + N round trips.
 *
 * Unassigning first, order by order, made the client redo that work the
 * expensive way. Each PATCH /api/orders/:id costs 11 sequential Supabase
 * round trips (token verify, before-image read, the write, orphan check,
 * two recalc reads, the shipment rewrite, four audit inserts) — and steps
 * 5-8 recalculate weight/pieces/total_cost/order_ids on a shipment that is
 * about to be deleted anyway. For a 3-order shipment that was ~37 round
 * trips instead of ~7, and it got worse linearly with order count.
 *
 * So: delete the shipment and let the endpoint do the unassigning. The
 * audit trail is equivalent — the endpoint writes the same 'unassign'
 * rows, with `reason: 'shipment-deleted'` as extra provenance.
 *
 * Safety rule: freight already committed to a carrier is never deleted in
 * bulk. Those rows are returned in `blocked` so the caller can report them.
 * This mirrors deleteShipment() in ShipmentsPage.jsx, which refuses a
 * Tendered shipment; the bulk path additionally refuses everything
 * downstream of Tendered, because a mistake here is N times as expensive.
 */

import { DbApi } from "../lib/api";
import { deleteShipmentById } from "./shipmentService";

export const PROTECTED_SHIPMENT_STATUSES = [
  "Tendered",
  "Tender Accepted",
  "Shipped",
  "In Transit",
  "Delivered",
];

/** Separate shipments are disjoint sets of orders, so they delete in
 *  parallel safely. Kept modest: each delete still fans out to N audit
 *  inserts server-side, and Supabase is the shared bottleneck. */
const CONCURRENCY = 6;

/** Status used for the refusal check. Rows built by ShipmentsPage already
 *  carry `_displayStatus` (= effectiveShipmentStatus); fall back to raw. */
function statusOf(row) {
  return row?._displayStatus || row?.status || "";
}

/**
 * Split the selection into what may be deleted and what must not be.
 * Pure — no I/O — so the refusal rule is unit-testable.
 */
export function partitionShipmentsForDelete(rows, selectedIds) {
  const ids = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  const deletable = [];
  const blocked = [];
  for (const s of rows || []) {
    if (!s || !ids.has(s.id)) continue;
    if (PROTECTED_SHIPMENT_STATUSES.includes(statusOf(s))) blocked.push(s);
    else deletable.push(s);
  }
  return { deletable, blocked };
}

/** Run `worker` over `items` with at most `limit` in flight. */
async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * Delete the selected shipments; the endpoint unassigns their orders.
 *
 * @param {Array} rows      shipment rows as rendered (carry `_linkedOrders`)
 * @param {Array} shipments raw shipments snapshot
 * @param {Array} orders    raw orders snapshot (unused; kept for call-site symmetry)
 * @param {Set|Array} selectedIds
 * @param {{ onProgress?: (done:number,total:number)=>void }} [opts]
 * @returns {Promise<{deleted:string[], ordersUnassigned:number, mastersDeleted:string[], blocked:Array, failed:Array}>}
 */
export async function deleteShipmentsAndUnassign(rows, shipments, orders, selectedIds, opts = {}) {
  const { onProgress } = opts;
  const { deletable, blocked } = partitionShipmentsForDelete(rows, selectedIds);

  const deleted = [];
  const failed = [];
  let ordersUnassigned = 0;
  const masterCandidates = new Set();
  let done = 0;

  await mapLimit(deletable, CONCURRENCY, async (row) => {
    try {
      // An MBOL's children are separate shipment rows; each one's own
      // delete cascades its orders, so no manual unassign is needed here
      // either. Sequential within the group — they share a master.
      if (row.bol_type === "MBOL") {
        const children = shipments.filter((s) => s.master_shipment_id === row.id);
        for (const child of children) {
          const res = await deleteShipmentById(child.id);
          deleted.push(child.id);
          ordersUnassigned += Number(res?.unassignedOrders || 0);
        }
      }

      const res = await deleteShipmentById(row.id);
      deleted.push(row.id);
      // Trust the server's count; fall back to the rendered snapshot only
      // if an older build didn't return one.
      ordersUnassigned += Number(
        res?.unassignedOrders ?? (row._linkedOrders?.length || 0)
      );

      if (row.bol_type === "CBOL" && row.master_shipment_id) {
        masterCandidates.add(row.master_shipment_id);
      }
    } catch (err) {
      failed.push({ id: row.id, error: err?.message || String(err) });
    } finally {
      done += 1;
      if (onProgress) onProgress(done, deletable.length);
    }
  });

  // MBOL cleanup: drop any master whose last CBOL we just removed.
  const deletedSet = new Set(deleted);
  const mastersDeleted = [];
  for (const masterId of masterCandidates) {
    if (deletedSet.has(masterId)) continue;
    const survivors = shipments.filter(
      (s) => s.master_shipment_id === masterId && s.bol_type === "CBOL" && !deletedSet.has(s.id)
    );
    if (survivors.length > 0) continue;
    try {
      await deleteShipmentById(masterId);
      mastersDeleted.push(masterId);
    } catch {
      // A master that refuses to delete is cosmetic, not data loss — the
      // CBOLs are already gone. Don't fail the whole run over it.
      await DbApi.remove("shipments", masterId).catch(() => {});
    }
  }

  return { deleted, ordersUnassigned, mastersDeleted, blocked, failed };
}

/** One-line toast summary. */
export function summarizeShipmentDelete(result) {
  if (!result) return "";
  const bits = [];
  bits.push(`${result.deleted.length} shipment${result.deleted.length === 1 ? "" : "s"} deleted`);
  bits.push(`${result.ordersUnassigned} order${result.ordersUnassigned === 1 ? "" : "s"} unassigned`);
  if (result.mastersDeleted.length) bits.push(`${result.mastersDeleted.length} master BOL${result.mastersDeleted.length === 1 ? "" : "s"} removed`);
  if (result.blocked.length) bits.push(`${result.blocked.length} skipped (tendered or in transit)`);
  if (result.failed.length) bits.push(`${result.failed.length} failed`);
  return bits.join(" · ");
}
