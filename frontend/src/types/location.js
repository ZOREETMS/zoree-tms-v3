// ═══════════════════════════════════════════════════════════════════
// REQ-24 — Ship-from / Ship-to location type + boundary mappings.
//
// The same "location" concept is represented in four different shapes
// across the stack. This module owns the canonical UI shape and the
// functions that translate to/from each boundary shape so we don't
// sprinkle ad-hoc object literals throughout the codebase (CLAUDE_RULES
// #5 — Data Model: Consistent naming / Shared types).
//
//   UI shape (canonical):
//     { name, city, state, zip }       — camelCase, used by forms/components
//
//   API / DB shape (orders.origin side):
//     { ship_from_name, origin_city,   — snake_case; matches DB columns.
//       origin_state,   origin_zip,    —  `origin_city`/`origin_state` are
//       origin }                       —  form-only — the server composes
//                                         the canonical "origin" string.
//
//   API / DB shape (orders.dest side):
//     { ship_to_name, dest_city,
//       dest_state,   dest_zip,
//       dest }
//
//   Lane / plan hand-off (camelCase at that boundary):
//     { shipFromName, shipToName }     — already established shape in
//                                        bulkPlanService + laneUtils.
//
// Keeping the UI layer on the canonical `{name, city, state, zip}` means
// the shared LocationFieldsEditor component doesn't need to know whether
// it's editing a ship-from or a ship-to — the caller maps the side at
// the service boundary.
// ═══════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} Location
 * @property {string} name   - Human-friendly location name (e.g. "Dallas DC")
 * @property {string} city
 * @property {string} state  - 2-letter state code, uppercased on persist
 * @property {string} zip    - 5-digit US ZIP
 */

/** Which side of the lane a location represents. */
export const SHIP_FROM = "from";
export const SHIP_TO = "to";

/** Canonical empty value — use this instead of inline {} literals. */
export function emptyLocation() {
  return { name: "", city: "", state: "", zip: "" };
}

/**
 * Build the legacy "CITY, ST ZIP" address string from a Location.
 * Preserves the shape used by planner / map / BOL code paths that still
 * key off the flat origin/dest columns.
 *
 * Canonical: `buildLocationString` in ordersService.js is now a thin
 * wrapper around this function. The old `buildShipmentLocationString`
 * in shipmentService.js has been removed. New code should import this
 * function directly from `src/types/location`.
 */
export function buildAddressString({ city, state, zip } = {}) {
  const head = [String(city || "").toUpperCase(), String(state || "").toUpperCase()]
    .filter(Boolean)
    .join(", ");
  return zip ? `${head} ${zip}`.trim() : head;
}

/**
 * Parse a legacy "CITY, ST ZIP" or "Name, City, ST ZIP" string into a
 * partial Location. If the string carries a leading location-name
 * prefix (e.g. "Dallas Warehouse, Dallas, TX 75207"), the name is NOT
 * recovered here — legacy rows that smuggled the name in this way need
 * to have it moved into ship_from_name/ship_to_name via the UI.
 */
export function parseAddressString(str) {
  if (!str) return { city: "", state: "", zip: "" };
  let s = String(str);
  let zip = "";
  const m = s.match(/\b(\d{5})\b/);
  if (m) {
    zip = m[1];
    s = s.replace(m[1], "").replace(/,?\s*$/, "").trim();
  }
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { city: "", state: "", zip };
  if (parts.length === 1) return { city: parts[0], state: "", zip };
  return {
    city: parts[parts.length - 2],
    state: parts[parts.length - 1],
    zip,
  };
}

/**
 * Hydrate a Location from an order row's ship-from fields.
 * Falls back to parsing the `origin` string so legacy rows still show
 * a populated form.
 */
export function locationFromOrderOrigin(order = {}) {
  const parsed = parseAddressString(order.origin);
  return {
    name:  order.ship_from_name || order.shipFromName || "",
    city:  parsed.city,
    state: parsed.state,
    zip:   order.origin_zip || parsed.zip || "",
  };
}

/**
 * Hydrate a Location from an order row's ship-to fields.
 */
export function locationFromOrderDest(order = {}) {
  const parsed = parseAddressString(order.dest);
  return {
    name:  order.ship_to_name || order.shipToName || "",
    city:  parsed.city,
    state: parsed.state,
    zip:   order.dest_zip || parsed.zip || "",
  };
}

/**
 * Hydrate a Location from a shipment row's ship-from fields.
 */
export function locationFromShipmentOrigin(shipment = {}) {
  const parsed = parseAddressString(shipment.origin);
  return {
    name:  shipment.ship_from_name || "",
    city:  parsed.city,
    state: parsed.state,
    zip:   shipment.origin_zip || parsed.zip || "",
  };
}

/**
 * Hydrate a Location from a shipment row's ship-to fields.
 */
export function locationFromShipmentDest(shipment = {}) {
  const parsed = parseAddressString(shipment.dest);
  return {
    name:  shipment.ship_to_name || "",
    city:  parsed.city,
    state: parsed.state,
    zip:   shipment.dest_zip || parsed.zip || "",
  };
}

/**
 * Flatten a pair of Locations into the DB-shape patch used by both
 * `orders` and `shipments` services — the two tables share the same
 * ship-from / ship-to column names (origin / dest / origin_zip /
 * dest_zip / ship_from_name / ship_to_name), so one mapper covers both.
 *
 * Empty fields become `null` so the server can distinguish "cleared"
 * from "unchanged" on a PATCH.
 *
 * Callers:
 *   • OrdersPage.createOrder / saveOrderEdit
 *   • shipmentService.updateShipmentLocations
 *   • NewShipmentModal.handleSubmit
 */
export function locationsToShipmentPatch(fromLoc, toLoc) {
  const safe = (v) => {
    const t = String(v ?? "").trim();
    return t.length ? t : null;
  };
  return {
    origin:         buildAddressString(fromLoc) || null,
    dest:           buildAddressString(toLoc)   || null,
    origin_zip:     safe(fromLoc?.zip),
    dest_zip:       safe(toLoc?.zip),
    ship_from_name: safe(fromLoc?.name),
    ship_to_name:   safe(toLoc?.name),
  };
}
