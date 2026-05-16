// ═══════════════════════════════════════════════════════════════════
// Order Status Constants — API-side single source of truth.
//
// Mirrors `frontend/src/constants/orders.js` (which owns the same list
// for the web UI dropdowns) and `mobile/src/shared/constants/
// orderConstants.js`. The DB column `orders.status` has no CHECK
// constraint per migration history (014/017/026 progressively added
// labels via INSERT/UPDATE statements, not CHECKs), so this module
// is the closest thing the API has to an enum lookup table.
//
// Reasons for not adding a DB CHECK constraint (decided 2026-05-07,
// see migration 026 commit message): historical rows pre-date some of
// the labels, and the OMS push path emits its own subset. A CHECK
// would force a lock-table-scan backfill that is out of scope for
// this fix.
//
// Per ZOREE TMS DB Rules § Data Integrity → "Use controlled values
// for statuses (enums or lookup tables)" — this module is the
// application-level enum. Any new label MUST be added here, in
// the frontend constants file, AND in the mobile constants file
// in the same change set.
// ═══════════════════════════════════════════════════════════════════

/**
 * Canonical lifecycle list. Order reflects state progression
 * (pre-plan → in-flight → terminal). Mirrors
 * frontend/src/constants/orders.js::ORDER_STATUSES.
 */
const ORDER_STATUSES = Object.freeze([
  'Unplanned',
  'Planned',
  'Consolidated',
  'Tendered',
  'Tender Accepted',
  'Shipped',
  'In Transit',
  'Delivered',
  'On Hold',
  'Planning Failed',
  'Cancelled',
]);

/**
 * Subset: statuses that mean the carrier has accepted the tender or
 * the order has progressed past that point. Once an order reaches
 * any of these states, the shipment plan owns the operational dates
 * (shipments.pickup_date / delivery_date); the order's user-intent
 * date fields (orders.ready_date / orders.due_date) MUST NOT be
 * rewritten by automated flows or by direct PATCHes.
 *
 * 'Confirmed' is intentionally included for parity with the legacy
 * label used by `shared/src/services/carrierPortalService.js` and
 * `mobile/src/shared/services/carrierPortalService.js`
 * (patchOrderConfirmed). If that label is ever retired, drop it
 * here in the same change.
 *
 * 'Cancelled' is included because a cancelled order's intent dates
 * are also operationally frozen — there is no business value in
 * editing them and doing so would create misleading audit rows.
 */
const POST_TENDER_ACCEPT_STATUSES = Object.freeze(new Set([
  'Tender Accepted',
  'Confirmed',
  'Shipped',
  'In Transit',
  'Delivered',
  'Cancelled',
]));

/**
 * Predicate — true when an order in this status has its
 * date fields frozen by the post-tender-accept rule.
 *
 * Defensive against null / undefined / unknown statuses: only a
 * recognised post-tender label returns true, so pre-tender / unknown
 * orders are never accidentally frozen.
 */
function isOrderPostTenderAccept(status) {
  return POST_TENDER_ACCEPT_STATUSES.has(status);
}

module.exports = {
  ORDER_STATUSES,
  POST_TENDER_ACCEPT_STATUSES,
  isOrderPostTenderAccept,
};
