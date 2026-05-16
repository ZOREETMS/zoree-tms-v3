// ═══════════════════════════════════════════════════════════════════
// mobile/src/services/tenderAcceptanceNotifier.ts
//
// Mobile-side mirror of frontend/src/services/tenderAcceptanceNotifier.js.
//
// Runs the two side-effects that MUST happen the moment a shipment
// transitions to "Tender Accepted" so external listeners update without
// a manual refresh:
//
//   1. OmsApi.push        — mirrors the accept into oms_orders
//                           (advances stage → 6 BOL Confirmed, stamps
//                           tms_shipment_id / carrier / PRO / BOL /
//                           seal / dock / pickup / delivery).
//   2. NotifyApi.broadcast — fires `tender_accepted` on the TMS
//                           WebSocket bridge so every TMS tab AND the
//                           standalone zoree-oms.html window
//                           (OmsLive subscriber) re-pull instantly.
//
// Called by:
//   - shipmentActionsService.acceptTender (mobile in-TMS accept)
//
// The mobile carrier-portal accept path (carrierPortalService.
// saveTenderResponse) currently inlines an equivalent OmsApi.push +
// NotifyApi.broadcast pair. A follow-up should migrate that caller to
// this service so the two mobile accept paths cannot drift — see
// CLAUDE_RULES §6 (no duplication). Out of scope for this fix because
// saveTenderResponse already works correctly and has a dedicated test
// suite asserting the inline contract.
//
// Failures are logged and surfaced in the returned result but never
// thrown — the TMS-side DB writes that drove this call have already
// committed, so a failed mirror / broadcast must not roll the UI back
// (CLAUDE_RULES §10).
// ═══════════════════════════════════════════════════════════════════

// @ts-expect-error — shared/api.js is JS, no .d.ts.
import { OmsApi, NotifyApi } from '../lib/api';

/**
 * Subset of the shipment row this service reads. Loose-typed because
 * the mobile data layer hands us either snake_case (Supabase row) or
 * camelCase (api/server.js dbToShipmentApi) shapes depending on the
 * read path.
 */
export interface TenderAcceptedShipment {
  id: string;
  carrier?: string;
  mode?: string;
  service_level?: string;
  pickup_date?: string;
  pickup?: string;
  delivery_date?: string;
  delivery?: string;
  bol_number?: string;
  seal_number?: string;
  origin?: string;
  dest?: string;
  weight?: number;
  pieces?: number;
  commodity?: string;
  cost?: number;
}

/**
 * Subset of the carrier-supplied accept response we propagate. Field
 * names match the web tenderAcceptanceNotifier contract so the server
 * /api/oms/push handler reads the same payload regardless of origin.
 */
export interface TenderAcceptResponse {
  proNumber?: string;
  carrierPickupDate?: string;
  serviceLevel?: string;
  bolNumber?: string;
  sealNumber?: string;
  dockDoor?: string;
  dockLoadStart?: string;
  dockLoadEnd?: string;
  notes?: string;
}

export interface PropagateTenderAcceptanceResult {
  /** Raw response from POST /api/oms/push, or null if it threw. */
  omsResult: any;
  /** Error message if the OMS push threw. */
  omsError: string | null;
  /** True iff the WebSocket broadcast succeeded. */
  notified: boolean;
  /** Error message if the broadcast threw. */
  notifyError: string | null;
}

const EMPTY_RESULT: PropagateTenderAcceptanceResult = {
  omsResult:  null,
  omsError:   null,
  notified:   false,
  notifyError: null,
};

/**
 * Push the accepted-tender mirror into oms_orders and broadcast
 * `tender_accepted` over the WS bridge. Both steps are best-effort —
 * the caller's preceding DB writes have already committed, so a
 * downstream failure here must not unwind them.
 */
export async function propagateTenderAcceptance(args: {
  shipment: TenderAcceptedShipment;
  response: TenderAcceptResponse;
  orderIds: string[];
}): Promise<PropagateTenderAcceptanceResult> {
  const { shipment, response, orderIds } = args;
  if (!shipment || !response) return { ...EMPTY_RESULT };

  const result: PropagateTenderAcceptanceResult = { ...EMPTY_RESULT };
  const safeOrderIds = Array.isArray(orderIds)
    ? orderIds.filter(Boolean).map(String)
    : [];

  // 1. OMS mirror — oms_orders upsert (REQ-24). Field fallback chain
  //    mirrors the web file exactly: response.* wins, then shipment.*,
  //    then empty. omsSync.setIf on the server skips empty strings so
  //    a blank value won't blow away an OMS-side default.
  try {
    result.omsResult = await OmsApi.push({
      shipmentId:    shipment.id,
      carrier:       shipment.carrier || '',
      mode:          shipment.mode || '',
      serviceLevel:  response.serviceLevel  || shipment.service_level || '',
      pickupDate:    response.carrierPickupDate
                       || shipment.pickup_date
                       || shipment.pickup
                       || '',
      deliveryDate:  shipment.delivery_date || shipment.delivery || '',
      proNumber:     response.proNumber  || '',
      bolNumber:     response.bolNumber  || shipment.bol_number  || '',
      sealNumber:    response.sealNumber || shipment.seal_number || '',
      dockNumber:    response.dockDoor   || '',
      dockLoadStart: response.dockLoadStart || '',
      dockLoadEnd:   response.dockLoadEnd   || '',
      origin:        shipment.origin || '',
      destination:   shipment.dest   || '',
      weight:        shipment.weight || 0,
      pieces:        shipment.pieces || 0,
      commodity:     shipment.commodity || '',
      cost:          shipment.cost || 0,
      orderIds:      safeOrderIds,
      notes:         response.notes || '',
    });
  } catch (err: any) {
    result.omsError = err?.message || String(err);
    // eslint-disable-next-line no-console
    console.warn('[tender-accept] OMS push failed:', result.omsError);
  }

  // 2. WebSocket broadcast — picked up by App-level wsClient (TMS web
  //    tabs and the mobile useExpressEvents listener) and by OmsLive
  //    in zoree-oms.html → triggers loadFromDB() + re-render.
  try {
    await NotifyApi.broadcast('tender_accepted', {
      shipmentId: shipment.id,
      proNumber:  response.proNumber || '',
      orderIds:   safeOrderIds,
      via:        'mobile-tms-accept',
    });
    result.notified = true;
  } catch (err: any) {
    result.notifyError = err?.message || String(err);
    // eslint-disable-next-line no-console
    console.warn('[tender-accept] WS notify failed:', result.notifyError);
  }

  return result;
}
