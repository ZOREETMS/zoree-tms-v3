/**
 * orderActionRules — pure status-gating logic for the buttons on
 * OrderDetailScreen (Plan, Tender, Cancel, Delete). Lives in the
 * service layer so the screen never duplicates the rules inline
 * (CLAUDE_RULES §6 — no large inline business logic).
 *
 * Source-of-truth alignment with the web TMS:
 *   • Plan        — only meaningful while the order is Unplanned. Cancelled
 *                   orders cannot be planned (QA bug #122). Already-
 *                   planned orders use the Unplan path on web; the mobile
 *                   detail screen does not yet expose Unplan, so we hide
 *                   Plan once the order is past Unplanned.
 *   • Tender      — requires a planned shipment (QA bug #120). Tendering
 *                   an unplanned order leaves the system in an
 *                   inconsistent state and the web disables the button
 *                   for the same reason.
 *   • Cancel      — allowed from any non-terminal state. Mirrors web.
 *   • Delete      — allowed from any state but Tender Accepted / In
 *                   Transit / Delivered (those touch carrier billing).
 *                   QA bug #121 added the Delete affordance to mobile;
 *                   gating here matches the web contract.
 *
 * All inputs accept the loose "order" shape DataContext provides, so
 * callers don't need to know whether the order originated from
 * dbToOrderApi (camelCase) or a raw DB fetch (snake_case).
 */

const TERMINAL_STATUSES = new Set<string>(['Delivered', 'Cancelled']);

/**
 * Deny-list for Delete. Once carriers / drivers are dispatched the
 * row is auditable, not disposable - users cancel instead. Web TMS
 * applies the same restriction in OrdersPage / OrderDetailModal.
 */
const NON_DELETABLE_STATUSES = new Set<string>([
  'Tender Accepted',
  'In Transit',
  'Delivered',
]);

/** Read the order's status with a sensible default so missing rows don't crash gating. */
export function getOrderStatus(order: any): string {
  return String(order?.status || 'Unplanned');
}

/** Read the linked shipment id, accepting either casing. */
export function getOrderShipmentId(order: any): string | null {
  return order?.shipmentId || order?.shipment_id || null;
}

/**
 * QA bug #122: Plan must be disabled (and visually so) once the order
 * is Cancelled. Also gate against statuses past Unplanned so we don't
 * re-plan a tendered or in-transit order from the mobile detail view -
 * the Replan flow lives on the web planner.
 */
export function canPlanOrder(order: any): boolean {
  const status = getOrderStatus(order);
  if (status !== 'Unplanned') return false;
  return true;
}

/**
 * QA bug #120: Tender option was visible the moment the order existed,
 * including before planning. Tendering an unplanned order would flip
 * the row's status without an associated shipment, which then
 * confuses every downstream report. Require a linked shipment AND a
 * status of "Planned" (the only state where tendering is the next
 * legal action).
 */
export function canTenderOrder(order: any): boolean {
  const status = getOrderStatus(order);
  if (status !== 'Planned') return false;
  if (!getOrderShipmentId(order)) return false;
  return true;
}

/** Cancel is allowed from any non-terminal state. */
export function canCancelOrder(order: any): boolean {
  const status = getOrderStatus(order);
  return !TERMINAL_STATUSES.has(status);
}

/**
 * QA bug #121: Delete is the new mobile affordance. Returning false
 * from this function should both hide and disable the button so QA
 * regression checks pass against the same hard rule the API enforces.
 */
export function canDeleteOrder(order: any): boolean {
  const status = getOrderStatus(order);
  if (NON_DELETABLE_STATUSES.has(status)) return false;
  return true;
}

/**
 * Convenience aggregate for screens that want to compute every flag in
 * one pass and pass them down to a presentational component. Slightly
 * cheaper than four separate calls, mainly useful for tests / future
 * card-based bulk actions.
 */
export function evaluateOrderActions(order: any) {
  return {
    canPlan:   canPlanOrder(order),
    canTender: canTenderOrder(order),
    canCancel: canCancelOrder(order),
    canDelete: canDeleteOrder(order),
  };
}
