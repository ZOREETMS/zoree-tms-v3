/**
 * Lane grouping utilities for bulk planning.
 * Handles ZIP normalization, lane key construction, and order grouping.
 */

/** Extract 5-digit ZIP from a string like "Atlanta, GA 30350" or "30350". */
export function normalizeZip(value) {
  const m = String(value || "").match(/\b(\d{5})\b/);
  return m ? m[1] : "";
}

// QA #141: when an order's `origin` / `dest` string is just a city (no
// state, no ZIP) but the dedicated typed columns carry the rest of the
// address, compose the canonical "CITY, ST ZIP" string from those columns
// so the planned shipment carries full address-to-address details and the
// Shipment Details modal stops rendering as "city-to-city". Falls back to
// the original string verbatim when nothing better is available.
function composeFullAddressString(rawAddress, city, state, zip) {
  const raw = String(rawAddress || "").trim();
  const hasStateOrZip = /,\s*[A-Z]{2}(\s|$)|\b\d{5}\b/.test(raw);
  if (raw && hasStateOrZip) return raw;
  const parts = [];
  const head = [String(city || "").toUpperCase(), String(state || "").toUpperCase()]
    .filter(Boolean)
    .join(", ");
  if (head) parts.push(head);
  if (zip) parts.push(String(zip));
  const composed = parts.join(" ").trim();
  return composed || raw;
}

export function fullOrderOrigin(order = {}) {
  return composeFullAddressString(
    order.origin,
    order.ship_from_city || order.origin_city,
    order.ship_from_state || order.origin_state,
    order.origin_zip,
  );
}

export function fullOrderDest(order = {}) {
  return composeFullAddressString(
    order.dest,
    order.ship_to_city || order.dest_city,
    order.ship_to_state || order.dest_state,
    order.dest_zip,
  );
}

/**
 * Normalize an address fragment for stable lane-key matching.
 * Lowercases, collapses internal whitespace, trims ends. ZIP is preserved
 * (different ZIP = different lane). Without this, OMS feeds with mixed
 * case ("College Park" vs "COLLEGE PARK") or stray whitespace produce
 * distinct lane keys for identical lanes — defeating consolidation.
 */
export function normalizeLane(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Build a lane key from an order's origin + destination.
 * Normalizes both sides so visually-identical addresses hash to one lane.
 */
export function buildLaneKey(order) {
  return `${normalizeLane(order.origin)} -> ${normalizeLane(order.dest)}`;
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
        // QA #141: prefer the canonical "CITY, ST ZIP" composed from the
        // typed ship-from / ship-to columns when the legacy free-text
        // origin/dest is missing state or ZIP. Falls back to the raw
        // string when the typed columns are also empty (legacy rows).
        origin: fullOrderOrigin(o),
        destination: fullOrderDest(o),
        originZip: normalizeZip(o.origin_zip || o.origin),
        destZip: normalizeZip(o.dest_zip || o.dest),
        // REQ-24: carry the ship-from / ship-to Location Name through lane
        // aggregation so shipments created by the bulk planner inherit the
        // same name that lives on the OMS order.
        shipFromName: o.ship_from_name || o.shipFromName || "",
        shipToName:   o.ship_to_name   || o.shipToName   || "",
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
    // QA #141: same full-address composition as buildLaneGroups so the
    // AI / single-shot plan path doesn't end up with city-only origin
    // strings on the resulting shipment row.
    origin: fullOrderOrigin(order),
    destination: fullOrderDest(order),
    originZip: normalizeZip(order.origin_zip || order.origin),
    destZip: normalizeZip(order.dest_zip || order.dest),
    // REQ-24: keep the Location Name on single-order lanes too.
    shipFromName: order.ship_from_name || order.shipFromName || "",
    shipToName:   order.ship_to_name   || order.shipToName   || "",
    freightClass: order.freight_class || "70",
    totalWeight: Number(order.weight || 0),
    totalPieces: Number(order.pieces || 0),
    orderIds: [order.id],
  };
}
