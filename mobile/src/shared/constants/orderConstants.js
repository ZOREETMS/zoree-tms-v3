/**
 * Order constants — shared by OrderFormScreen, OrderDetailScreen, and
 * any future bulk-action UI that needs the same blank order shape or
 * controlled value lists. Centralising these here satisfies the rule
 * "no hardcoded data in UI" — screens import from this module rather
 * than inlining their own status / mode strings.
 */

/**
 * Default shape used when the user starts a brand-new order via
 * Dashboard → Quick Actions → New Order. Field names match the API
 * camelCase contract (apiOrderToDbPatch tolerates both casings, but
 * we standardise on camelCase here so the form pre-population path
 * for an existing order — which comes back from GET /api/orders in
 * dbToOrderApi shape — is symmetrical with the create path).
 */
export const EMPTY_ORDER = {
  id: '',
  customer: '',
  origin: '',
  destination: '',
  originZip: '',
  destZip: '',
  shipFromName: '',
  shipToName: '',
  weight: '',
  pieces: '',
  commodity: 'General',
  shipMode: 'TL',
  serviceLevel: '',
  incoterms: '',
  refNum: '',
  poNum: '',
  readyDate: '',
  dueDate: '',
  status: 'Unplanned',
  preferredCarrier: '',
  excludedCarrier: '',
  noConsolidate: false,
  hazmat: false,
  noContractRate: false,
  dedicatedEquip: false,
  notes: '',
};

/**
 * Controlled status values. Mirrors the orders.status check
 * constraint after migration 014 (tender_accepted) and 017 (shipped).
 * Source-of-truth for the UI dropdown; do not free-text statuses.
 */
export const ORDER_STATUSES = [
  'Unplanned',
  'Planned',
  'Tendered',
  'Tender Accepted',
  'Shipped',
  'Delivered',
  'Cancelled',
];

/**
 * Ship modes the planner recognises. Kept in lock-step with the web
 * NewOrderModal options so an order created on mobile and one created
 * on web are interchangeable to the planner.
 */
export const SHIP_MODES = ['TL', 'LTL', 'Parcel', 'Intermodal'];

/**
 * Service-level options. Free-text on the DB side (REQ-10), but
 * the UI should offer the canonical list so planning constraints stay
 * matchable against the rates table.
 */
export const SERVICE_LEVELS = [
  '',
  'Standard',
  'Guaranteed',
  'Expedited',
  'White Glove',
];
