/**
 * Lane grouping utilities for bulk planning.
 * Port of frontend/src/utils/laneUtils.js for React Native.
 */

/** Extract 5-digit ZIP from a string like "Atlanta, GA 30350" or "30350". */
export function normalizeZip(value) {
  const m = String(value || '').match(/\b(\d{5})\b/);
  return m ? m[1] : '';
}

/**
 * Build a lane key from an order's origin + destination.
 * Uses the API-transformed field names (origin, destination).
 */
export function buildLaneKey(order) {
  const orig = order.origin || order.dest || '';
  const dest = order.destination || order.dest || '';
  return `${orig} -> ${dest}`;
}

/**
 * Group selected orders into lane objects for rating.
 * Returns an array of lane objects ready for BulkPlanApi.rate().
 */
export function buildLaneGroups(selectedOrders) {
  const groups = new Map();

  selectedOrders.forEach((o) => {
    const origin = o.origin || '';
    const destination = o.destination || o.dest || '';
    const key = `${origin} -> ${destination}`;

    if (!groups.has(key)) {
      groups.set(key, {
        laneKey: key,
        origin,
        destination,
        originZip: normalizeZip(o.origin_zip || o.originZip || origin),
        destZip: normalizeZip(o.dest_zip || o.destZip || destination),
        freightClass: o.freight_class || o.freightClass || '70',
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
  const origin = order.origin || '';
  const destination = order.destination || order.dest || '';
  return {
    laneKey: `${origin} -> ${destination}`,
    origin,
    destination,
    originZip: normalizeZip(order.origin_zip || order.originZip || origin),
    destZip: normalizeZip(order.dest_zip || order.destZip || destination),
    freightClass: order.freight_class || order.freightClass || '70',
    totalWeight: Number(order.weight || 0),
    totalPieces: Number(order.pieces || 0),
    orderIds: [order.id],
  };
}

/**
 * Classify load type based on weight.
 */
export function classifyLoadType(weight) {
  if (weight >= 35000) return 'Full TL';
  if (weight >= 15000) return 'Partial TL';
  return 'LTL';
}
