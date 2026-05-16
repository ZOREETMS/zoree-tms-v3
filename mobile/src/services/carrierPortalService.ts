/**
 * Mobile carrier portal service — read tenders for the active
 * portal carrier and persist accept/reject responses.
 *
 * Web parity reference: frontend/src/services/carrierPortalService.js.
 * The web file uses `import.meta.env.VITE_*` and `window.ZOREE_*` to
 * pick the active portal carrier — neither exists in React Native, so
 * mobile uses a default constant that callers can override at the prop
 * level (e.g. an admin setting in a future iteration).
 *
 * Wire shape:
 *   - Tender responses are persisted as a magic-marker line in
 *     `shipments.notes`. The web reads/writes the same format so a
 *     mobile-side accept is reflected in the web TMS view.
 *   - On accept, linked orders flip to "Tender Accepted" — matches
 *     migration 014 / shipmentOrderService.confirmOrdersForShipment.
 */

import { DbApi, OmsApi, NotifyApi } from '../lib/api';
import { resolveCarrierName } from '../shared/utils/carrierPortal';

/** Override-able default. Apps can pass a different value to listTenders / pickActiveTenders. */
export const DEFAULT_PORTAL_CARRIER = 'JB Hunt';

const RESPONSE_MARKER = '[CP_RESPONSE]';

/* ── Carrier name normalization ─────────────────────────────────── */

function normalizeCarrier(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Fuzzy match: a shipment belongs to a carrier when the names overlap. */
export function isCarrierShipment(shipment: any, carrierName: string): boolean {
  const shipmentCarrier = normalizeCarrier(resolveCarrierName(shipment));
  const target = normalizeCarrier(carrierName);
  if (!shipmentCarrier || !target) return false;
  return shipmentCarrier === target
    || shipmentCarrier.includes(target)
    || target.includes(shipmentCarrier);
}

/** Sorted unique carrier names from a shipment list — for the picker. */
export function getUniqueCarrierNames(shipments: any[]): string[] {
  const seen = new Map<string, string>();
  (shipments || []).forEach((s) => {
    const name = resolveCarrierName(s);
    if (name && name !== 'Carrier TBD') {
      const key = normalizeCarrier(name);
      if (!seen.has(key)) seen.set(key, name);
    }
  });
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/* ── Response markers in shipment.notes ─────────────────────────── */

export interface TenderResponse {
  action: 'accept' | 'reject';
  proNumber?: string;
  /** Carrier-confirmed pickup date (overrides shipment.pickup_date on accept). */
  carrierPickupDate?: string;
  /** Carrier-confirmed delivery date (overrides shipment.delivery_date on accept). */
  carrierDeliveryDate?: string;
  /** Carrier-confirmed dock door assignment (writes to shipments.dock_door). */
  dockDoor?: string;
  /** Loading window start (writes to shipments.loading_start). */
  dockLoadStart?: string;
  /** Loading window end   (writes to shipments.loading_end). */
  dockLoadEnd?: string;
  rejectReason?: string;
  rejectNote?: string;
  respondedAt?: string;
  respondedAtIso?: string;
  carrierName?: string;
}

/**
 * Pre-populated defaults for the tender accept screen, sourced from the
 * shipment row so the carrier sees the planner's commitments and can
 * adjust before confirming. Both snake_case and camelCase variants are
 * tolerated to match the mixed shapes that arrive from the API layer.
 */
export interface TenderDefaults {
  pickupDate: string;
  deliveryDate: string;
  dockDoor: string;
  dockLoadStart: string;
  dockLoadEnd: string;
}

export function extractTenderDefaults(shipment: any): TenderDefaults {
  if (!shipment) {
    return { pickupDate: '', deliveryDate: '', dockDoor: '', dockLoadStart: '', dockLoadEnd: '' };
  }
  return {
    pickupDate:    String(shipment.pickup_date    ?? shipment.pickupDate    ?? ''),
    deliveryDate:  String(shipment.delivery_date  ?? shipment.deliveryDate  ?? ''),
    // dock-door fallback chain: prefer the canonical `dock_door`
    // column, then either casing of the alias `dock_assigned` /
    // `dockAssigned` that some upstream paths produce. The camelCase
    // alias was missing previously so a shipment hydrated through
    // dbToShipmentApi (camelCase emitter) lost its dock door on the
    // tender modal — caught by the carrierPortalService unit test.
    dockDoor:      String(shipment.dock_door      ?? shipment.dockDoor      ?? shipment.dock_assigned ?? shipment.dockAssigned ?? ''),
    dockLoadStart: String(shipment.loading_start  ?? shipment.dockLoadStart ?? ''),
    dockLoadEnd:   String(shipment.loading_end    ?? shipment.dockLoadEnd   ?? ''),
  };
}

/** Pull the last [CP_RESPONSE] payload off shipment.notes if present. */
export function parseResponseFromNotes(notes: unknown): TenderResponse | null {
  const text = String(notes || '');
  const idx = text.lastIndexOf(RESPONSE_MARKER);
  if (idx < 0) return null;
  const payload = text.slice(idx + RESPONSE_MARKER.length).trim();
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object' ? (parsed as TenderResponse) : null;
  } catch {
    return null;
  }
}

function stripResponseMarker(notes: unknown): string {
  const text = String(notes || '');
  const idx = text.lastIndexOf(RESPONSE_MARKER);
  if (idx < 0) return text.trim();
  return text.slice(0, idx).trim();
}

/** Compose the new notes value for a shipment after persisting a response. */
export function buildNotesWithResponse(
  existingNotes: unknown,
  response: TenderResponse,
): string {
  const cleaned = stripResponseMarker(existingNotes);
  const markerLine = `${RESPONSE_MARKER} ${JSON.stringify(response)}`;
  return cleaned ? `${cleaned}\n${markerLine}` : markerLine;
}

/**
 * Index responses by shipment id so the portal screen can render
 * status pills without re-parsing notes per row.
 */
export function buildPersistedTenderResponses(
  shipments: any[],
): Record<string, TenderResponse> {
  const map: Record<string, TenderResponse> = {};
  (shipments || []).forEach((s) => {
    if (!s || !s.id) return;
    const response = parseResponseFromNotes(s.notes);
    if (response) map[s.id] = response;
  });
  return map;
}

/**
 * UI-effective shipment status: a shipment marked "Tendered" with an
 * accept response in notes is shown as "Tender Accepted". Mirrors the
 * web's effectiveShipmentStatus exactly so badges read identically.
 */
export function effectiveShipmentStatus(s: any): string {
  if (!s) return '';
  const raw = String(s.status || '').trim();
  if (raw === 'Tendered') {
    const r = parseResponseFromNotes(s.notes);
    if (r?.action === 'accept') return 'Tender Accepted';
  }
  if (raw === 'Confirmed') return 'Tender Accepted';
  return raw || '—';
}

/* ── Tender listing ─────────────────────────────────────────────── */

/**
 * Filter shipments to the active portal carrier and only include rows
 * worth showing in the tender list (Tendered / Tender Accepted / Tender Rejected).
 */
export function pickActiveTenders(
  shipments: any[],
  activeCarrier: string = DEFAULT_PORTAL_CARRIER,
): any[] {
  const carrier = activeCarrier || DEFAULT_PORTAL_CARRIER;
  return (shipments || []).filter((s) => {
    if (!s || !isCarrierShipment(s, carrier)) return false;
    const status = effectiveShipmentStatus(s);
    return status === 'Tendered' || status === 'Tender Accepted' || status === 'Tender Rejected';
  });
}

/* ── Date format / labels ───────────────────────────────────────── */

function nowFormatted(): { respondedAt: string; respondedAtIso: string } {
  const date = new Date();
  return {
    respondedAt:
      date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      + ' ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    respondedAtIso: date.toISOString(),
  };
}

/* ── Mutations ──────────────────────────────────────────────────── */

/**
 * Trim a string-ish value, returning undefined for blanks so we never
 * write an empty string into a column that already holds a planned value.
 */
function nonEmpty(value: unknown): string | undefined {
  const s = String(value ?? '').trim();
  return s ? s : undefined;
}

/**
 * Effective values for the 5 carrier-acceptance fields, blending
 * carrier-supplied overrides with the existing shipment defaults.
 * The carrier's value wins when present; otherwise we fall back to
 * the shipment's planned value so writeback is never destructive.
 */
function resolveAcceptedFields(shipment: any, response: TenderResponse) {
  const defaults = extractTenderDefaults(shipment);
  return {
    pickupDate:    nonEmpty(response.carrierPickupDate)   ?? nonEmpty(defaults.pickupDate),
    deliveryDate:  nonEmpty(response.carrierDeliveryDate) ?? nonEmpty(defaults.deliveryDate),
    dockDoor:      nonEmpty(response.dockDoor)            ?? nonEmpty(defaults.dockDoor),
    dockLoadStart: nonEmpty(response.dockLoadStart)       ?? nonEmpty(defaults.dockLoadStart),
    dockLoadEnd:   nonEmpty(response.dockLoadEnd)         ?? nonEmpty(defaults.dockLoadEnd),
  };
}

/**
 * Persist a tender response on the shipment row. Mirrors web logic:
 *   - notes gets a [CP_RESPONSE] marker line with the payload
 *   - on accept: status flips to "Tender Accepted" (QA #61 — until
 *     migration 036 widened the shipments status CHECK constraint we
 *     used to leave it at "Tendered" because "Tender Accepted" was
 *     rejected at the DB level; that's what produced the QA report
 *     "Order shows Tender Accepted but Shipment doesn't"), carrier
 *     pro number + dock door + loading window + pickup/delivery dates
 *     are written to shipments
 *   - on reject: status flips to "Tender Rejected"
 *   - on accept, linked orders flip to "Tender Accepted" and inherit
 *     the same dock + dates so the OMS warehouse modals (REQ-24) read
 *     a consistent picture
 *   - on accept, OmsApi.push mirrors the same fields into oms_orders
 *     (parity with frontend/src/services/tenderAcceptanceNotifier.js)
 *
 * @param shipment      The shipment row being responded to.
 * @param responseData  User-supplied response (action + proNumber etc.).
 * @param extra.orders  Optional order list for the cascade (status sync).
 */
export async function saveTenderResponse(
  shipment: any,
  responseData: Partial<TenderResponse> & { action: 'accept' | 'reject' },
  extra: { orders?: any[] } = {},
): Promise<TenderResponse> {
  if (!shipment || !shipment.id) {
    throw new Error('saveTenderResponse: shipment.id is required');
  }
  if (responseData.action !== 'accept' && responseData.action !== 'reject') {
    throw new Error("saveTenderResponse: action must be 'accept' or 'reject'");
  }

  const stamp = nowFormatted();
  const carrierName = resolveCarrierName(shipment);
  const normalized: TenderResponse = {
    ...responseData,
    respondedAt: responseData.respondedAt || stamp.respondedAt,
    respondedAtIso: responseData.respondedAtIso || stamp.respondedAtIso,
    carrierName,
  };

  const notes = buildNotesWithResponse(shipment.notes, normalized);
  const patch: Record<string, any> = { notes };

  if (normalized.action === 'accept') {
    const accepted = resolveAcceptedFields(shipment, normalized);
    // QA #61: write the shipment to 'Tender Accepted' so it tracks
    // the linked orders (which flip to the same value below). Allowed
    // by migration 036 — the historical 'Tendered' fallback is
    // obsolete.
    patch.status = 'Tender Accepted';
    patch.pro_number = normalized.proNumber || null;

    if (accepted.pickupDate) {
      patch.pickup_date = accepted.pickupDate;
      patch.pickup = accepted.pickupDate;
    }
    if (accepted.deliveryDate) {
      patch.delivery_date = accepted.deliveryDate;
    }
    if (accepted.dockDoor)      patch.dock_door     = accepted.dockDoor;
    if (accepted.dockLoadStart) patch.loading_start = accepted.dockLoadStart;
    if (accepted.dockLoadEnd)   patch.loading_end   = accepted.dockLoadEnd;
  } else {
    patch.status = 'Tender Rejected';
  }

  await DbApi.patch('shipments', shipment.id, patch);

  // On accept, cascade order status. Use Promise.allSettled so a
  // single order failure doesn't unwind the whole response.
  if (normalized.action === 'accept' && Array.isArray(extra.orders) && extra.orders.length) {
    const accepted = resolveAcceptedFields(shipment, normalized);
    const orders = extra.orders.filter((o: any) => o && o.id);
    await Promise.allSettled(
      orders.map((o: any) => {
        // Order ready/due/pickup/delivery dates are frozen post-tender per
        // api/constants/orderStatus.js (POST_TENDER_ACCEPT_STATUSES). Only
        // dock-scheduling fields are mirrored here — parity with
        // bulkPlanExecution's syncDockToOms hop.
        const p: Record<string, any> = { status: 'Tender Accepted' };
        if (accepted.dockDoor)      p.dock_door     = accepted.dockDoor;
        if (accepted.dockLoadStart) p.loading_start = accepted.dockLoadStart;
        if (accepted.dockLoadEnd)   p.loading_end   = accepted.dockLoadEnd;
        return DbApi.patch('orders', o.id, p);
      }),
    );

    // Mirror the accept into oms_orders so the OMS warehouse views
    // (Pick/Pack/Stage/Ship) see the dock + dates without a refresh.
    // Best-effort: a failed push must not roll back the TMS write.
    try {
      await OmsApi.push({
        shipmentId:    shipment.id,
        carrier:       shipment.carrier || '',
        mode:          shipment.mode || '',
        serviceLevel:  shipment.service_level || '',
        pickupDate:    accepted.pickupDate    || '',
        deliveryDate:  accepted.deliveryDate  || '',
        proNumber:     normalized.proNumber   || '',
        bolNumber:     shipment.bol_number    || '',
        sealNumber:    shipment.seal_number   || '',
        dockNumber:    accepted.dockDoor      || '',
        dockLoadStart: accepted.dockLoadStart || '',
        dockLoadEnd:   accepted.dockLoadEnd   || '',
        origin:        shipment.origin || '',
        destination:   shipment.dest   || '',
        weight:        shipment.weight || 0,
        pieces:        shipment.pieces || 0,
        commodity:     shipment.commodity || '',
        cost:          shipment.cost || 0,
        orderIds:      orders.map((o: any) => String(o.id)),
        notes:         '',
      });
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn('[carrierPortal] OMS push failed:', err?.message || err);
    }
  }

  // Bug #159: WebSocket fan-out so the web TMS (and zoree-oms.html)
  // refresh without a manual reload. The web equivalent lives in
  // frontend/src/services/tenderAcceptanceNotifier.js — we mirror the
  // event name and payload shape here so existing listeners light up
  // identically whether the action originated on web or mobile.
  // Best-effort: a failed broadcast must not roll back the DB writes.
  try {
    const event = normalized.action === 'accept' ? 'tender_accepted' : 'tender_rejected';
    const orderIds = Array.isArray(extra.orders)
      ? extra.orders.filter((o: any) => o && o.id).map((o: any) => String(o.id))
      : [];
    await NotifyApi.broadcast(event, {
      shipmentId: shipment.id,
      proNumber:  normalized.proNumber || '',
      orderIds,
      via:        'mobile-carrier-portal',
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.warn('[carrierPortal] notify broadcast failed:', err?.message || err);
  }

  return normalized;
}
