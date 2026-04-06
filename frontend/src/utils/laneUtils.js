/**
 * Lane grouping utilities for bulk planning.
 * Handles ZIP normalization, lane key construction, and order grouping.
 */

/** Extract 5-digit ZIP from a string like "Atlanta, GA 30350" or "30350". */
export function normalizeZip(value) {
  const m = String(value || "").match(/\b(\d{5})\b/);
  return m ? m[1] : "";
}

/**
 * Build a lane key from an order's origin + destination.
 * Keeps full address including ZIP for accurate grouping.
 */
export function buildLaneKey(order) {
  return `${order.origin || ""} -> ${order.dest || ""}`;
}

/**
 * Group selected orders into lane objects for rating.
 * Orders with identical origin -> dest strings land in the same lane.
 * Returns an array of lane objects ready for BulkPlanApi.rate().
 */
export function buildLaneGroups(selectedOrders) {
  const groups = new Map();

  selectedOrders.forEach((o) => {
    const key = buildLaneKey(o);
    if (!groups.has(key)) {
      groups.set(key, {
        laneKey: key,
        origin: o.origin || "",
        destination: o.dest || "",
        originZip: normalizeZip(o.origin_zip || o.origin),
        destZip: normalizeZip(o.dest_zip || o.dest),
        freightClass: o.freight_class || "70",
        totalWeight: 0,
        totalPieces: 0,
        orderIds: [],
      });
    }
    const g = groups.get(key);
    g.totalWeight += Number(o.weight || 0);
    g.totalPieces += Number(o.pieces || 0);
    g.orderIds.push(o.id);
  });

  return Array.from(groups.values());
}

/**
 * Build a single-order lane object (for individual rating).
 */
export function buildSingleOrderLane(order) {
  return {
    laneKey: buildLaneKey(order),
    origin: order.origin || "",
    destination: order.dest || "",
    originZip: normalizeZip(order.origin_zip || order.origin),
    destZip: normalizeZip(order.dest_zip || order.dest),
    freightClass: order.freight_class || "70",
    totalWeight: Number(order.weight || 0),
    totalPieces: Number(order.pieces || 0),
    orderIds: [order.id],
  };
}
