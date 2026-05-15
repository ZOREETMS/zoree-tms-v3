// frontend/src/services/dbExplorerCatalog.js
//
// Single source of truth for which logical "tables" the DB Explorer
// exposes and how each one is resolved out of the App data prop.
//
// Why a separate module:
//   - dbExplorerService.js owns the SQL-parser; it should not also own
//     the catalog (Rule 6: services-first, no mega-modules).
//   - QA #312 expanded the catalog with several tables that were already
//     loaded into App state but never surfaced (equipment_types,
//     warehouse_dock_config, planning_parameters, route_templates,
//     documents) plus one derived view (dock_appointments).
//   - Keeping resolvers here means future entities can be added with a
//     one-line entry, without touching the query engine.
//
// Resolver contract:
//   resolve(data) -> array of row objects | null
//   A null return signals "table not connected" — the executor turns
//   that into a "Table not found" error so the user sees something
//   actionable.

import { buildRateLaneId, isCzarLiteApplicable } from "./rateService";

/**
 * QA #307 — the Rate Management page renders a composite "lane ID"
 * (lane + YYYYMMDD expiry) but the raw rates row in the DB only stores
 * the bare lane in one column and the expiry in another. DB Explorer
 * users comparing the two were missing the expiry tail. We surface it
 * as a synthetic `rate_id` column on every row without mutating the
 * source, so SELECT * shows what they expect AND the underlying
 * columns are still visible.
 */
function withRateId(rows, carriers) {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    // QA #308 — Rate Management grid shows a non-empty "Rate" cell for
    // every row because it falls back across several pricing columns:
    //   rate → rate_per_mile → flat_rate → min_charge.
    // DB Explorer was rendering just the raw `rate` column, which is
    // null on tenants that use a non-per-mile pricing model. Surface a
    // single `rate_effective` synthetic that picks the first non-null
    // value with a small label so the user can tell which underlying
    // column it came from.
    const candidates = [
      ['rate',          r.rate],
      ['rate_per_mile', r.rate_per_mile],
      ['flat_rate',     r.flat_rate],
      ['min_charge',    r.min_charge],
    ];
    const picked = candidates.find(([, v]) => v != null && v !== '');
    const rateEffective = picked ? `${picked[1]} (${picked[0]})` : null;
    return {
      rate_id: buildRateLaneId(r),
      // QA #309 — CZARLITE eligibility on the Rate Management page is
      // a computed AND of (mode === LTL) + (rate.czarlite === true OR
      // carrier.czarlite_enabled === true). DB Explorer was showing
      // the raw `rate.czarlite` column, which is `false` for rows
      // whose carrier owns the CzarLite eligibility flag — so users
      // saw `false` in DB Explorer while the Rate Management grid
      // (correctly) surfaced `true`. Expose the effective value as
      // `czarlite_effective` so SELECT * shows both: the raw flag
      // stays in `czarlite` and the computed status lives in
      // `czarlite_effective`.
      czarlite_effective: isCzarLiteApplicable(r, carriers),
      // QA #308 — see candidates fallback above.
      rate_effective: rateEffective,
      ...r,
    };
  });
}

/**
 * QA #310 — Driver Roster page renders fields the planner expects
 * (cdlClass, vehicle, hosToday, endorsements) but the raw drivers row
 * uses snake_case (cdl_class, assigned_vehicle, hos_today,
 * endorsements_csv). When the planner ran `SELECT * FROM drivers` they
 * saw the DB columns and not the Roster's logical column names, which
 * read as "missing data". Surface the camelCase Roster aliases as
 * synthetic columns alongside the raw row so both views agree.
 *
 * Aliases are non-destructive: the original column names are kept too.
 */
function withDriverAliases(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const endorsements = Array.isArray(r.endorsements)
      ? r.endorsements
      : typeof r.endorsements === 'string'
      ? r.endorsements.split(',').map((s) => s.trim()).filter(Boolean)
      : typeof r.endorsements_csv === 'string'
      ? r.endorsements_csv.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    return {
      ...r,
      cdlClass: r.cdlClass ?? r.cdl_class ?? r.cdlClass ?? null,
      vehicle:  r.vehicle  ?? r.assigned_vehicle ?? null,
      hosToday: r.hosToday ?? r.hos_today ?? null,
      endorsements,
    };
  });
}

/**
 * QA #312 — dock_appointments has no backing table; appointments are
 * derived from shipments that carry dock_door/dock_start/dock_duration
 * fields. We surface them here so the DB Explorer's table list isn't
 * lying about what exists, with an explicit note column so users can
 * see this is a derived view rather than a base table.
 */
function deriveDockAppointments(shipments) {
  if (!Array.isArray(shipments)) return [];
  return shipments
    .filter((s) => s && (s.dock_door || s.dockDoor))
    .map((s) => ({
      shipment_id: s.id,
      door:        s.dock_door  || s.dockDoor  || null,
      start:       s.dock_start || s.dockStart || null,
      duration:    s.dock_duration || s.dockDuration || null,
      pickup_date: s.pickup_date || s.pickupDate || null,
      origin:      s.origin || null,
      status:      s.status || null,
      _derived_from: "shipments",
    }));
}

/**
 * Catalog: logical table name → resolver. Keep the keys snake_case to
 * mirror Postgres table names and to match what users will type into
 * SELECT statements.
 */
export const TABLE_CATALOG = {
  orders:                (d) => d.orders || [],
  shipments:             (d) => d.shipments || [],
  carriers:              (d) => d.carriers || [],
  rates:                 (d) => withRateId(d.rates || [], d.carriers || []),
  drivers:               (d) => withDriverAliases(d.drivers || []),
  locations:             (d) => d.locations || [],
  items:                 (d) => d.items || [],
  invoices:              (d) => d.invoices || [],
  lane_preferences:      (d) => d.lanePreferences || [],
  packaging_units:       (d) => d.packagingUnits || [],
  // QA #312 additions — already loaded by refreshData() but were not
  // previously selectable from DB Explorer.
  equipment_types:       (d) => d.equipmentTypes || [],
  warehouse_dock_config: (d) => d.warehouseDockConfigs || [],
  planning_parameters:   (d) => d.planningParameters || [],
  route_templates:       (d) => d.routeTemplates || [],
  documents:             (d) => d.documents || [],
  // Derived (no base table).
  dock_appointments:     (d) => deriveDockAppointments(d.shipments || []),
};

/**
 * Resolve a table name against the data prop. Returns an array of rows
 * (possibly empty) or null when the table is unknown.
 */
export function resolveTable(name, data) {
  if (!name) return null;
  const resolver = TABLE_CATALOG[name.toLowerCase()];
  if (!resolver) return null;
  const rows = resolver(data || {});
  return Array.isArray(rows) ? rows : [];
}

/**
 * QA #313 — when the user runs `SELECT * FROM <table>` without an
 * explicit ORDER BY, DB Explorer falls back to sorting by `id` ASC (see
 * QA #306 in dbExplorerService). That keeps DB Explorer aligned with
 * pages that sort by id, but it diverges from pages that sort by some
 * other column. The Planning Parameters page, for example, asks the
 * server for `?order=category.asc` (planningParametersService) so users
 * who opened DB Explorer saw the same rows in a different order.
 *
 * The fix lives in the catalog because the catalog is already the
 * single source of truth for table behaviour; the executor stays
 * generic. Add a row here when a TMS page orders by something other
 * than id and a non-trivial number of users compare the two surfaces.
 *
 * Shape: tableName -> { col, dir }. `dir` is optional (defaults to
 * 'asc'). Use the snake_case column name as it appears in the resolved
 * row objects.
 */
export const TABLE_DEFAULT_ORDER = {
  // Mirrors planningParametersService.js → /db/planning_parameters?...&order=category.asc.
  planning_parameters: { col: 'category', dir: 'asc' },
};

/**
 * Lookup helper for the executor. Returns the { col, dir } pair for a
 * table, or null when there is no override (executor then uses its
 * existing id-based fallback).
 */
export function getDefaultOrderFor(name) {
  if (!name) return null;
  return TABLE_DEFAULT_ORDER[name.toLowerCase()] || null;
}

/**
 * List of available table names, sorted alphabetically — used by the
 * "Table not found" error message and (eventually) the sidebar.
 */
export function listTables() {
  return Object.keys(TABLE_CATALOG).sort();
}
