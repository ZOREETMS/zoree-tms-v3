/**
 * Ship-From / Ship-To filter helpers.
 *
 * Pure functions — no React, no API. Used by OrdersPage, ShipmentsPage, and any
 * future screen that needs to filter rows by the origin / destination pair
 * already persisted on the orders and shipments tables.
 *
 * Columns relied on (existing, no migration):
 *   origin, dest, ship_from_name, ship_to_name
 */

const SIDE_FIELDS = {
  from: { name: "ship_from_name", address: "origin" },
  to:   { name: "ship_to_name",   address: "dest"   },
};

/**
 * Case-insensitive substring match on the combined "name + address" text for
 * the requested side. Empty / blank filter value means "no filter applied".
 */
export function matchesLocation(row, side, value) {
  const needle = String(value || "").trim().toLowerCase();
  if (!needle) return true;
  const f = SIDE_FIELDS[side];
  if (!f || !row) return false;
  const haystack = `${row[f.name] || ""} ${row[f.address] || ""}`.toLowerCase();
  return haystack.includes(needle);
}
