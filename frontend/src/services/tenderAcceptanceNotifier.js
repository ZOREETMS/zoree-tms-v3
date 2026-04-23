// ═══════════════════════════════════════════════════════════════════
// tenderAcceptanceNotifier — post-accept propagation.
//
// Runs the two side-effects that MUST happen the moment a shipment
// transitions to "Tender Accepted" so external listeners update
// without a manual refresh:
//
//   1. OmsApi.push        — mirrors the accept into oms_orders
//                           (advances stage → 6, stamps pickup /
//                           carrier / PRO / BOL / seal / dock).
//   2. NotifyApi.broadcast — fires `tender_accepted` on the TMS
//                           WebSocket so every TMS tab AND the
//                           standalone zoree-oms.html window
//                           (OmsLive subscriber) re-pull instantly.
//
// Called by:
//   - ShipmentsPage.confirmAcceptTender    (TMS-side accept)
//   - CarrierPortalPage.handleSubmitResponse (carrier-side accept)
//
// Previously only the Shipments path fired these — carrier-portal
// accepts left zoree-oms.html stale until a hard refresh. Centralizing
// both call sites here fixes that and keeps the logic out of the UI
// (CLAUDE_RULES §1, §4: services layer owns cross-system side-effects).
//
// Failures are logged and surfaced in the returned result but never
// thrown — the TMS-side DB writes that drove this call have already
// committed, so a failed mirror / broadcast must not roll the UI back.
// ═══════════════════════════════════════════════════════════════════

import { OmsApi, NotifyApi } from "../lib/api";

/**
 * @param {object} args
 * @param {object} args.shipment       TMS shipments row (id, carrier, mode, origin, dest, weight, …)
 * @param {object} args.response       Accept-response meta:
 *                                       { proNumber, carrierPickupDate, serviceLevel,
 *                                         bolNumber, sealNumber, dockDoor,
 *                                         dockLoadStart, dockLoadEnd, notes }
 * @param {string[]} args.orderIds     IDs of orders linked to the shipment
 * @returns {Promise<{
 *   omsResult: object|null,   // raw response from POST /api/oms/push, or null if it threw
 *   omsError:  string|null,   // error message if the OMS push threw
 *   notified:  boolean,       // true iff WS broadcast succeeded
 *   notifyError: string|null, // error message if the broadcast threw
 * }>}
 */
export async function propagateTenderAcceptance({ shipment, response, orderIds }) {
  const result = {
    omsResult:   null,
    omsError:    null,
    notified:    false,
    notifyError: null,
  };
  if (!shipment || !response) return result;

  const safeOrderIds = Array.isArray(orderIds) ? orderIds.filter(Boolean).map(String) : [];

  // 1. OMS mirror — oms_orders upsert (REQ-24).
  try {
    result.omsResult = await OmsApi.push({
      shipmentId:    shipment.id,
      carrier:       shipment.carrier || "",
      mode:          shipment.mode || "",
      serviceLevel:  response.serviceLevel || "",
      pickupDate:    response.carrierPickupDate || shipment.pickup_date || shipment.pickup || "",
      deliveryDate:  shipment.delivery_date || shipment.delivery || "",
      proNumber:     response.proNumber || "",
      bolNumber:     response.bolNumber || "",
      sealNumber:    response.sealNumber || "",
      dockNumber:    response.dockDoor || "",
      dockLoadStart: response.dockLoadStart || "",
      dockLoadEnd:   response.dockLoadEnd || "",
      origin:        shipment.origin || "",
      destination:   shipment.dest || "",
      weight:        shipment.weight || 0,
      pieces:        shipment.pieces || 0,
      commodity:     shipment.commodity || "",
      cost:          shipment.cost || 0,
      orderIds:      safeOrderIds,
      notes:         response.notes || "",
    });
  } catch (err) {
    result.omsError = err?.message || String(err);
    // eslint-disable-next-line no-console
    console.warn("[tender-accept] OMS push failed:", result.omsError);
  }

  // 2. WebSocket broadcast — picked up by App-level wsClient (TMS tabs)
  //    and by OmsLive in zoree-oms.html → triggers loadFromDB() + re-render.
  try {
    await NotifyApi.broadcast("tender_accepted", {
      shipmentId: shipment.id,
      proNumber:  response.proNumber || "",
      orderIds:   safeOrderIds,
    });
    result.notified = true;
  } catch (err) {
    result.notifyError = err?.message || String(err);
    // eslint-disable-next-line no-console
    console.warn("[tender-accept] WS notify failed:", result.notifyError);
  }

  return result;
}
