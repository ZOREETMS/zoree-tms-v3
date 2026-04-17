import { DbApi, ShipmentsApi } from "../lib/api";
import { unassignOrderFromShipment, updateOrderStatus } from "./orderWriteService";
import { deleteShipmentById } from "./shipmentService";

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
  await unassignOrderFromShipment(orderId);
  const remaining = orders.filter((o) => o.shipment_id === shipmentId && o.id !== orderId);

  if (remaining.length === 0) {
    const ship = shipments.find((s) => s.id === shipmentId);
    await deleteShipmentById(shipmentId);
    if (ship?.master_shipment_id) {
      const siblingCbols = shipments.filter(
        (s) => s.master_shipment_id === ship.master_shipment_id && s.id !== shipmentId
      );
      if (siblingCbols.length === 0) {
        await deleteShipmentById(ship.master_shipment_id);
        return `Order ${orderId} unassigned. Shipment ${shipmentId} and master ${ship.master_shipment_id} deleted.`;
      }
    }
    return `Order ${orderId} unassigned. Shipment ${shipmentId} deleted.`;
  }

  const newWeight = remaining.reduce((s, o) => s + (Number(o.weight) || 0), 0);
  const newPieces = remaining.reduce((s, o) => s + (Number(o.pieces) || 0), 0);
  await DbApi.patch("shipments", shipmentId, { weight: newWeight, pieces: newPieces });
  return `Order ${orderId} unassigned from shipment ${shipmentId}`;
}

export async function confirmOrdersForShipment(row, shipments, orders) {
  const allShipmentIds = [
    row.id,
    ...(row.bol_type === "MBOL"
      ? shipments.filter((s) => s.master_shipment_id === row.id && s.bol_type === "CBOL").map((s) => s.id)
      : []),
  ];
  const linkedOrders = orders.filter((o) => allShipmentIds.includes(String(o.shipment_id || "")));
  // Keep order status within DB-controlled values; accepted tender is tracked on shipment notes/status.
  await Promise.all(linkedOrders.map((o) => updateOrderStatus(o.id, "Tendered")));
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

