/**
 * mobile/src/services/shipmentActionsService.ts
 *
 * Orchestration layer for the action footer on the Shipment Detail
 * screen — the mobile counterpart to the web `ShipmentDetailModal`
 * footer (Tender to Carrier / Withdraw Tender / Change Carrier /
 * Invoice / Documents / Dock schedule / Contact Carrier / Send to WMS).
 *
 * Per CLAUDE_RULES §1 / §3 / §4 the screen stays a dumb renderer; this
 * service owns every API call, payload shaping, and error normalisation.
 * Each exported function returns a flat result object the screen can
 * render directly with no thrown exceptions for expected user-facing
 * states (e.g. "no email on file", "shipment already has open invoice").
 *
 * Why this file exists separately from shipmentTenderService:
 *   - shipmentTenderService owns *only* the tender-email payload build
 *     + carrier-email lookup. That helper is reused here unchanged.
 *   - The other actions (withdraw, change-carrier, invoice creation)
 *     have nothing to do with the tender email contract — they're
 *     server-side status / commerce flows. Bundling them into
 *     shipmentTenderService would muddy the single-purpose rule.
 */

import {
  ShipmentsApi,
  BulkPlanApi,
} from '../shared/api';
import { buildLaneKey } from '../shared/utils/laneUtils';
import { sendShipmentTender } from './shipmentTenderService';
import type {
  SendShipmentTenderResult,
} from './shipmentTenderService';
import type { ShipmentDetailViewModel } from './shipmentDetailService';

/* ── Shared result shape ──────────────────────────────────────────── */

export interface ShipmentActionResult {
  ok: boolean;
  message: string;
  /** Optional payload — set by actions that return data (e.g. new id). */
  data?: any;
}

/* ── Tender (parity with web onTender, minus the email-send modal) ── */

/**
 * Wraps `sendShipmentTender` with the audited Planned → Tendered
 * status flip so the mobile flow matches the web `onTender(row)`
 * sequence: PATCH /api/shipments/:id (audited), then POST
 * /api/tender/email. The web modal also runs the two in parallel, but
 * mobile keeps them sequential so a status flip without a delivered
 * email surfaces an honest "tendered but email failed" message instead
 * of a green confirmation.
 */
export async function tenderShipment(args: {
  vm: ShipmentDetailViewModel;
  shipment: any;
  carriers: any[];
}): Promise<ShipmentActionResult & { tender: SendShipmentTenderResult }> {
  const { vm, shipment, carriers } = args;
  const id = shipment?.id || shipment?.shipment_id;
  const carrierName = vm?.carrier || shipment?.carrier || '';

  if (!id) {
    return {
      ok: false,
      message: 'Shipment is not loaded — cannot tender.',
      tender: { ok: false, sent: false, to: '', message: '' },
    };
  }
  if (!carrierName || carrierName === '—') {
    return {
      ok: false,
      message:
        'This shipment has no carrier assigned. Assign a carrier before tendering.',
      tender: { ok: false, sent: false, to: '', message: '' },
    };
  }

  // 1. Audited Planned → Tendered status flip. The dedicated route
  //    writes the change_history row and emits SHIPMENT_UPDATED for
  //    every connected web tab. The previous direct TenderApi.sendEmail
  //    skipped the status flip entirely, so the web view still showed
  //    the shipment as "Planned" after the mobile user tendered it.
  try {
    await ShipmentsApi.update(id, {
      status: 'Tendered',
      carrier: carrierName,
    });
  } catch (err: any) {
    return {
      ok: false,
      message: err?.message || 'Could not move shipment to Tendered.',
      tender: { ok: false, sent: false, to: '', message: '' },
    };
  }

  // 2. Fire the tender email. The existing service already handles the
  //    "no email on file" / "smtp not configured" cases as non-throws.
  const tender = await sendShipmentTender({ vm, shipment, carriers });

  if (tender.sent) {
    return {
      ok: true,
      message: `Shipment tendered. Email sent to ${tender.to || 'carrier'}.`,
      tender,
    };
  }

  // Status flipped successfully but email did NOT go out — surface that
  // honestly so the planner knows to follow up out-of-band.
  return {
    ok: true,
    message: `Shipment tendered, but email was not sent: ${tender.message}`,
    tender,
  };
}

/* ── Withdraw tender (parity with web withdrawTender) ─────────────── */

/**
 * Roll a Tendered shipment back to Planned. Uses the audited route so
 * the change_history "status → Planned" row is written and connected
 * web tabs refresh via SHIPMENT_UPDATED.
 *
 * MBOL cascade: if the shipment is a master BOL, every child CBOL is
 * also flipped back to Planned, mirroring web withdrawTender.
 */
export async function withdrawTender(args: {
  shipment: any;
  shipments: any[];
}): Promise<ShipmentActionResult> {
  const { shipment, shipments } = args;
  const id = shipment?.id || shipment?.shipment_id;
  if (!id) return { ok: false, message: 'Shipment is not loaded.' };

  try {
    await ShipmentsApi.update(id, { status: 'Planned' });
    if (shipment.bol_type === 'MBOL') {
      const children = (shipments || []).filter(
        (s) => s.master_shipment_id === id && s.bol_type === 'CBOL',
      );
      await Promise.all(
        children.map((c) =>
          ShipmentsApi.update(c.id, { status: 'Planned' }),
        ),
      );
    }
    return { ok: true, message: `Tender withdrawn for ${id}.` };
  } catch (err: any) {
    return {
      ok: false,
      message: err?.message || 'Could not withdraw tender.',
    };
  }
}

// QA 240 (2026-05-12): "After tendering, the system doesn't show
// Accept or Reject options". Web has simulate-accept/reject for QA
// flows (a Tendered shipment can be flipped to Tender Accepted or
// Tender Rejected without round-tripping through the carrier portal).
// Mirror both on mobile. Both use the audited /api/db/shipments PATCH
// so the REQ-02 status row lands in change_history and the connected
// orders cascade via the existing event listeners.

export async function acceptTender(args: {
  shipment: any;
}): Promise<ShipmentActionResult> {
  const { shipment } = args;
  const id = shipment?.id || shipment?.shipment_id;
  if (!id) return { ok: false, message: 'Shipment is not loaded.' };
  try {
    await ShipmentsApi.update(id, { status: 'Tender Accepted' });
    return { ok: true, message: `Tender accepted for ${id}.` };
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Could not accept tender.' };
  }
}

export async function rejectTender(args: {
  shipment: any;
}): Promise<ShipmentActionResult> {
  const { shipment } = args;
  const id = shipment?.id || shipment?.shipment_id;
  if (!id) return { ok: false, message: 'Shipment is not loaded.' };
  try {
    await ShipmentsApi.update(id, { status: 'Tender Rejected' });
    return { ok: true, message: `Tender rejected for ${id}.` };
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Could not reject tender.' };
  }
}

/* ── Change carrier (parity with web fetchChangeCarrierQuotes
   + confirmChangeCarrier + services/shipmentService.changeShipmentCarrier) */

export interface CarrierQuote {
  carrier: string;
  mode?: string;
  totalCharge?: number;
  czarBase?: number;
  czarBaseGross?: number;
  fscCharge?: number;
  serviceLevel?: string;
  transitDays?: number;
  miles?: number;
  rateId?: string;
  equipment?: string;
  deliveryDate?: string;
  czarlite?: boolean;
}

/**
 * Fetch ranked carrier quotes for the shipment's lane. Mirrors the
 * web `fetchChangeCarrierQuotes`: builds a single-lane payload off the
 * shipment row, posts it to /api/bulk-plan/rate (optimize:cost), filters
 * out quotes with no transit time, then sorts by total cost ascending.
 *
 * Soft-fails to an empty list on any error so the modal can render
 * "No carrier quotes available for this lane." instead of crashing.
 */
export async function fetchChangeCarrierQuotes(
  shipment: any,
): Promise<CarrierQuote[]> {
  if (!shipment) return [];

  const originZip =
    String(shipment.origin_zip || shipment.origin || '').match(/\b(\d{5})\b/)?.[1] ||
    '';
  const destZip =
    String(shipment.dest_zip || shipment.dest || '').match(/\b(\d{5})\b/)?.[1] ||
    '';

  // buildLaneKey expects { origin, destination } shape; the shipment row
  // has `dest`, not `destination`. Build a small shim so the lane key
  // stays consistent with the rates index even for mobile-issued shipments.
  const laneInput = {
    origin: shipment.origin || '',
    destination: shipment.dest || '',
  };

  const lane = {
    laneKey: buildLaneKey(laneInput),
    origin: shipment.origin || '',
    destination: shipment.dest || '',
    originZip,
    destZip,
    freightClass: '70',
    totalWeight: Number(shipment.weight || 0),
    totalPieces: Number(shipment.pieces || 0),
    orderIds: Array.isArray(shipment.order_ids) ? shipment.order_ids : [],
  };

  try {
    const rateRes: any = await BulkPlanApi.rate([lane], 'cost');
    const results = Array.isArray(rateRes?.results) ? rateRes.results : [];
    const quotes: CarrierQuote[] = results[0]?.quotes || [];
    return quotes
      .filter((q) => (q.transitDays ?? 0) > 0)
      .sort((a, b) => (a.totalCharge || 0) - (b.totalCharge || 0));
  } catch {
    return [];
  }
}

function computeDeliveryDate(pickup: string | null, transitDays?: number): string | null {
  if (!pickup || !transitDays || transitDays <= 0) return null;
  const d = new Date(pickup);
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + transitDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Persist the carrier change. Mirrors web `changeShipmentCarrier`:
 * builds the canonical patch (carrier / mode / total_cost / rate /
 * fuel_surcharge / miles / service_level [/ rate_id / equipment /
 * delivery_date]) and POSTs it to /api/shipments/:id/change-carrier
 * (the audited route). The server writes per-field change_history
 * rows and broadcasts SHIPMENT_UPDATED.
 */
export async function confirmChangeCarrier(args: {
  shipment: any;
  quote: CarrierQuote;
}): Promise<ShipmentActionResult> {
  const { shipment, quote } = args;
  const id = shipment?.id || shipment?.shipment_id;
  if (!id) return { ok: false, message: 'Shipment is not loaded.' };
  if (!quote || !quote.carrier) {
    return { ok: false, message: 'Pick a carrier first.' };
  }

  const payload: Record<string, any> = {
    carrier: quote.carrier,
    mode: quote.mode || shipment.mode || null,
    total_cost:
      quote.totalCharge != null ? quote.totalCharge : (shipment.total_cost || 0),
    rate:
      quote.czarBaseGross != null
        ? quote.czarBaseGross
        : quote.czarBase != null
        ? quote.czarBase
        : shipment.rate || 0,
    fuel_surcharge:
      quote.fscCharge != null ? quote.fscCharge : (shipment.fuel_surcharge || 0),
    miles: quote.miles != null ? quote.miles : shipment.miles,
    service_level: quote.serviceLevel || shipment.service_level || null,
  };
  if (quote.rateId) payload.rate_id = quote.rateId;
  if (quote.equipment !== undefined) {
    const eq =
      typeof quote.equipment === 'string'
        ? quote.equipment.trim()
        : quote.equipment;
    payload.equipment = eq || null;
  }
  const pickup = shipment.pickup_date || null;
  const explicit = (quote.deliveryDate || '').trim();
  if (explicit) {
    payload.delivery_date = explicit;
  } else {
    const computed = computeDeliveryDate(pickup, quote.transitDays);
    if (computed) payload.delivery_date = computed;
  }

  try {
    const res = await ShipmentsApi.changeCarrier(id, payload);
    return {
      ok: true,
      message: `Carrier changed to ${quote.carrier}.`,
      data: res,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: err?.message || 'Could not change carrier.',
    };
  }
}

/* ── Invoice (parity with web handleCreateInvoiceFromShipment) ────── */

/**
 * One-click "create invoice from shipment". Idempotent on the server —
 * a re-invoke against a shipment that already has an open invoice
 * returns that one with `reused: true`. Mirrors the web one-click flow
 * exactly so finance teams see the same invoice id regardless of where
 * the button was tapped.
 */
export async function createInvoiceFromShipment(
  shipmentId: string,
): Promise<ShipmentActionResult> {
  if (!shipmentId) return { ok: false, message: 'Shipment id is required.' };
  try {
    const result: any = await ShipmentsApi.createInvoice(shipmentId);
    const inv = result?.invoice;
    if (!inv?.id) {
      return {
        ok: false,
        message: `Could not create invoice for ${shipmentId}.`,
      };
    }
    const num = inv.invoice_number || inv.id;
    return {
      ok: true,
      message: result.reused
        ? `Reusing existing invoice ${num} for ${shipmentId}.`
        : `Invoice ${num} created (On Hold) for ${shipmentId}.`,
      data: inv,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: `Invoice creation failed: ${err?.message || 'unknown error'}`,
    };
  }
}
