import { DbApi, ShipmentsApi } from "../lib/api";
import { unassignOrderFromShipment, updateOrderStatus } from "./orderWriteService";

/**
 * REQ-03: manually add an order to an existing shipment.
 * Returns the backend response: { ok, shipment, order, recalc, before }.
 * Throws with a descriptive error for 4xx/5xx so the UI can show it.
 *
 * @param {string} orderId
 * @param {string} shipmentId
 */
export async function addOrderToShipment(orderId, shipmentId) {
  if (!orderId || !shipmentId) throw new Error("orderId and shipmentId are both required");
  return ShipmentsApi.addOrder(shipmentId, orderId);
}

export async function unassignOrderAndCleanupShipment(orderId, shipmentId, orders, shipments) {
  // Backend (PATCH /api/orders/:id) owns the side-effects:
  //   1. clears the order's shipment_id + sets status='Unplanned'
  //   2. orphan cleanup: deletes the shipment (and master, if last sibling) when empty
  //   3. recalc: updates remaining shipment's weight/pieces/total_cost/fuel/accessorials/order_ids
  // The client only computes the user-facing toast string from in-memory snapshots.
  await unassignOrderFromShipment(orderId);

  const remaining = orders.filter((o) => o.shipment_id === shipmentId && o.id !== orderId);
  if (remaining.length > 0) {
    return `Order ${orderId} unassigned from shipment ${shipmentId}`;
  }

  const ship = shipments.find((s) => s.id === shipmentId);
  if (ship?.master_shipment_id) {
    const siblingCbols = shipments.filter(
      (s) => s.master_shipment_id === ship.master_shipment_id && s.id !== shipmentId
    );
    if (siblingCbols.length === 0) {
      return `Order ${orderId} unassigned. Shipment ${shipmentId} and master ${ship.master_shipment_id} deleted.`;
    }
  }
  return `Order ${orderId} unassigned. Shipment ${shipmentId} deleted.`;
}

export async function confirmOrdersForShipment(row, shipments, orders) {
  const allShipmentIds = [
    row.id,
    ...(row.bol_type === "MBOL"
      ? shipments.filter((s) => s.master_shipment_id === row.id && s.bol_type === "CBOL").map((s) => s.id)
      : []),
  ];
  const linkedOrders = orders.filter((o) => allShipmentIds.includes(String(o.shipment_id || "")));
  // REQ-13: propagate the shipment's accepted-tender state to the underlying
  // order(s). The orders table has no status CHECK constraint, so we can
  // use the explicit "Tender Accepted" label (which lights up the green
  // badge in the order list).
  await Promise.all(linkedOrders.map((o) => updateOrderStatus(o.id, "Tender Accepted")));
  return linkedOrders;
}

export async function unplanOrdersForShipmentRemoval(row, shipments, orders) {
  for (const o of row._linkedOrders || []) {
    await unassignOrderFromShipment(o.id);
  }

  if (row.bol_type === "MBOL") {
    const children = shipments.filter((s) => s.master_shipment_id === row.id);
    for (const child of children) {
      const childOrders = orders.filter((o) => o.shipment_id === child.id);
      for (const co of childOrders) {
        await unassignOrderFromShipment(co.id);
      }
      await DbApi.remove("shipments", child.id).catch(() => {});
    }
  }
}

