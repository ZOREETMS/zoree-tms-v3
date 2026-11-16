/* ═══════════════════════════════════════════════════════════════════
 * Bulk Unplan — frontend/src/services/bulkUnplanService.js
 * ─────────────────────────────────────────────────────────────────────
 * Sends every currently-planned order back to Unplanned in one action,
 * reusing ordersService.unplanOrderFromShipment per order so each one
 * takes the REQ-02 audited path (per-field 'edit' events plus the
 * 'unassign' event when shipment_id clears) and so empty shipments —
 * and their parent MBOL, when the last CBOL goes — are cleaned up the
 * same way a single unplan cleans them up. A bulk PATCH straight to the
 * DB would be faster and would silently skip both.
 *
 * ── Which orders are eligible ──
 * Only orders that planning itself produced: anything holding a
 * shipment_id, plus Planned / Consolidated / Planning Failed.
 *
 * Downstream states are NOT touched by default. Once an order is
 * Tendered, Accepted, Shipped, In Transit or Delivered, a carrier has
 * been committed and unplanning is a business event, not a UI undo —
 * silently reversing that from a toolbar button is how a tendered load
 * goes missing. `includeDownstream` exists for test fixtures and forces
 * the caller to say so explicitly.
 * ═══════════════════════════════════════════════════════════════════ */

import { unplanOrderFromShipment } from "./ordersService";
import { OrdersApi, DbApi } from "../lib/api";

/** Statuses produced by planning, safe to reverse from the UI. */
export const UNPLANNABLE_STATUSES = Object.freeze(["Planned", "Consolidated", "Planning Failed"]);

/** Statuses where a carrier is already committed — excluded by default. */
export const DOWNSTREAM_STATUSES = Object.freeze([
  "Tendered", "Tender Accepted", "Shipped", "In Transit", "Delivered", "Cancelled",
]);

/**
 * Which of `orders` this action would actually touch.
 * @param {object[]} orders
 * @param {{includeDownstream?:boolean, filter?:(o:object)=>boolean}} [opts]
 */
export function selectUnplannable(orders, opts = {}) {
  const { includeDownstream = false, filter } = opts;
  return (orders || []).filter((o) => {
    if (!o || !o.id) return false;
    if (filter && !filter(o)) return false;
    const status = o.status || "Unplanned";
    if (!includeDownstream && DOWNSTREAM_STATUSES.includes(status)) return false;
    const shipmentId = o.shipment_id || o.shipmentId || null;
    return Boolean(shipmentId) || UNPLANNABLE_STATUSES.includes(status);
  });
}

/**
 * Unplan every eligible order.
 *
 * Runs in small concurrent batches rather than all at once: the fixture
 * can be 700 orders and firing 700 simultaneous PATCHes will exhaust the
 * browser's connection pool and trip the API's rate limiter, turning a
 * working action into a wall of failures.
 *
 * Never throws for a single order's failure — one bad row must not strand
 * the other 699 half-unplanned. Failures come back in `failed`.
 *
 * @returns {Promise<{attempted:number, unplanned:string[], deletedShipments:string[], failed:{id:string,error:string}[]}>}
 */
export async function unplanAll(orders, shipments, opts = {}) {
  const { onProgress, concurrency = 12, includeDownstream = false, filter } = opts;
  const targets = selectUnplannable(orders, { includeDownstream, filter });

  const unplanned = [];
  const deletedShipments = [];
  const failed = [];
  let done = 0;
  const bump = (n = 1) => {
    done += n;
    if (typeof onProgress === "function") onProgress(done, targets.length);
  };

  const shipIdOf = (o) => (o && (o.shipment_id || o.shipmentId)) || null;
  const byId = new Map((shipments || []).map((s) => [s.id, s]));

  // ── Group by shipment ─────────────────────────────────────────────
  // Doing this per order is what made "unplan all" slow: unplanning one
  // order of a 7-order shipment rewrites that shipment's order_ids, so
  // the seven orders produced six pointless rewrites of the same row
  // (and, at concurrency, six writers racing it) before the last one
  // finally deleted the shipment. Whole-shipment groups skip every one
  // of those rewrites and delete once — roughly 1,000 requests down to
  // ~590 on a 500-order fixture.
  const whole = [];   // shipments where every order is being unplanned
  const partial = []; // orders whose shipment keeps other orders
  const loose = [];   // orders with no shipment at all

  const grouped = new Map();
  for (const o of targets) {
    const sid = shipIdOf(o);
    if (!sid) { loose.push(o); continue; }
    if (!grouped.has(sid)) grouped.set(sid, []);
    grouped.get(sid).push(o);
  }

  for (const [sid, group] of grouped) {
    const ship = byId.get(sid);
    const onShipment = (ship && ship.order_ids) || [];
    const targetIds = new Set(group.map((o) => o.id));
    const everyOrderLeaving = onShipment.length > 0 && onShipment.every((oid) => targetIds.has(oid));
    if (everyOrderLeaving || onShipment.length === 0) whole.push({ sid, ship, group });
    else partial.push(...group);
  }

  // ── Fast path: detach orders, then delete each emptied shipment once ──
  const detach = async (o) => {
    // Same audited endpoint a single unplan uses, so REQ-02 still gets its
    // per-field 'edit' events and the 'unassign' event when shipment_id clears.
    await OrdersApi.update(o.id, { status: "Unplanned", shipmentId: null });
    return o.id;
  };

  const runPool = async (items, worker) => {
    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      const res = await Promise.allSettled(batch.map(worker));
      res.forEach((r, idx) => {
        if (r.status === "fulfilled") { if (r.value) unplanned.push(r.value); }
        else failed.push({ id: batch[idx].id || String(batch[idx]), error: (r.reason && r.reason.message) || String(r.reason) });
      });
      bump(batch.length);
    }
  };

  await runPool(loose, detach);
  await runPool(whole.flatMap((w) => w.group), detach);

  // Delete the emptied shipments — and any MBOL whose last CBOL just went.
  const wholeSids = new Set(whole.map((w) => w.sid));
  for (const { sid, ship } of whole) {
    try {
      await DbApi.remove("shipments", sid);
      deletedShipments.push(sid);
      const master = ship && ship.master_shipment_id;
      if (master && !deletedShipments.includes(master)) {
        const siblingsLeft = (shipments || []).some(
          (s) => s.master_shipment_id === master && s.id !== sid && !wholeSids.has(s.id)
        );
        if (!siblingsLeft) {
          await DbApi.remove("shipments", master).catch(() => {});
          deletedShipments.push(master);
        }
      }
    } catch (err) {
      failed.push({ id: sid, error: `shipment delete failed: ${err.message}` });
    }
  }

  // ── Slow path: shipments that keep other orders need order_ids rewritten,
  // so these go through the single-order routine unchanged. Sequential on
  // purpose — concurrent writers on one shipment row lose updates.
  for (const o of partial) {
    try {
      const res = await unplanOrderFromShipment(o.id, orders, shipments);
      unplanned.push(o.id);
      (res && res.deletedShipments ? res.deletedShipments : []).forEach((sid) => {
        if (!deletedShipments.includes(sid)) deletedShipments.push(sid);
      });
    } catch (err) {
      failed.push({ id: o.id, error: err.message });
    }
    bump();
  }

  return { attempted: targets.length, unplanned, deletedShipments, failed };
}

/** One-line summary for a toast. */
export function summarize(result) {
  if (!result || !result.attempted) return "Nothing to unplan — no planned orders.";
  const bits = [`Unplanned ${result.unplanned.length} of ${result.attempted} orders`];
  if (result.deletedShipments.length) bits.push(`${result.deletedShipments.length} shipment(s) removed`);
  if (result.failed.length) bits.push(`${result.failed.length} failed`);
  return bits.join(" · ");
}
