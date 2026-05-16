// ═══════════════════════════════════════════════════════════════════
// mobile/src/services/shipmentOrderService.ts
//
// Mobile mirror of frontend/src/services/shipmentOrderService.js —
// specifically the `confirmOrdersForShipment` helper used by the
// in-TMS tender-accept flow (NOT the carrier-portal flow, which has
// its own cascade in carrierPortalService.saveTenderResponse with
// dock-field mirroring).
//
// Why a separate mobile file
// ──────────────────────────
// The web file is JS and imports a few web-only helpers. Mobile uses
// its offline-aware OrdersApi wrapper for the status flip, so we keep
// the port narrow: it returns the list of orders that were cascaded
// (the shipmentActionsService caller passes that list to the OMS
// notifier as orderIds).
//
// Important — dates are immutable after tender accept (memory:
// "feedback_dates_immutable_after_tender_accept"). This cascade ONLY
// touches `status`. Pickup / ready / due / delivery / dock fields are
// out of scope here. The carrier-portal cascade additionally mirrors
// dock_door / loading_start / loading_end onto the order rows, but
// that path is entered via the carrier UI which collects new dock
// commitments; the in-TMS accept reuses the planner's existing dock
// assignment already on the shipment row.
// ═══════════════════════════════════════════════════════════════════

import { updateOrderStatus } from './offline/offlineOrderActions';

/**
 * Cascade the shipment's tender-accept state to its linked orders.
 * MBOL handling matches the web file: if `row` is the master BOL,
 * orders linked to every child CBOL are included.
 *
 * Status-only by design (CLAUDE_RULES + post-tender date freeze).
 *
 * @param row        The shipment being accepted (MBOL or CBOL or stand-alone).
 * @param shipments  The full shipment list — needed only to discover CBOL children of an MBOL.
 * @param orders     The full order list — filtered to those linked to row (or its children).
 * @returns          The orders that were flipped to "Tender Accepted".
 */
export async function confirmOrdersForShipment(
  row: any,
  shipments: any[],
  orders: any[],
): Promise<any[]> {
  if (!row || !row.id) return [];
  const all = Array.isArray(shipments) ? shipments : [];
  const orderList = Array.isArray(orders) ? orders : [];

  const allShipmentIds: string[] = [
    String(row.id),
    ...(row.bol_type === 'MBOL'
      ? all
          .filter((s) => s && s.master_shipment_id === row.id && s.bol_type === 'CBOL')
          .map((s) => String(s.id))
      : []),
  ];

  const linkedOrders = orderList.filter((o) =>
    o && allShipmentIds.includes(String(o.shipment_id || '')),
  );

  // REQ-13 parity: orders table has no status CHECK constraint, so we
  // can use the explicit "Tender Accepted" label (which lights up the
  // green badge in the order list).
  //
  // Use Promise.allSettled so a single order failure (e.g. row deleted
  // mid-flight) does not unwind the whole cascade — same pattern as
  // carrierPortalService.saveTenderResponse.
  await Promise.allSettled(
    linkedOrders.map((o) => updateOrderStatus(o.id, 'Tender Accepted', o)),
  );

  return linkedOrders;
}
