import { OrdersApi } from "../lib/api";

export async function updateOrderStatus(orderId, status) {
  return OrdersApi.update(orderId, { status });
}

export async function unassignOrderFromShipment(orderId) {
  return OrdersApi.update(orderId, { status: "Unplanned", shipmentId: null });
}

