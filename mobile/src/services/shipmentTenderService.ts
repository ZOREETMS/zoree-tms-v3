/**
 * mobile/src/services/shipmentTenderService.ts
 *
 * Orchestration layer for the "Send Tender Email" action on the
 * mobile Shipment Detail screen.
 *
 * Why this file exists
 * ────────────────────
 * Per CLAUDE_RULES §1/§3/§4 screens must be dumb renderers and any
 * non-trivial business logic lives in a service. The previous inline
 * `handleTender` on ShipmentDetailScreen called `TenderApi.sendEmail`
 * directly with an incomplete payload:
 *
 *   - it never resolved the carrier's email, so the backend
 *     /api/tender/email route rejected the call with
 *     400 "Valid 'to' email required" — the user-facing
 *     "no email in 'to'" failure.
 *   - it sent `destination` / `pickupDate` / `deliveryDate`, but the
 *     server reads `dest` / `pickup` / `delivery`. Even with a valid
 *     `to` the rendered email would have shown blank route + dates.
 *
 * This service owns:
 *   - building the tender payload using the server's field contract,
 *   - delegating the actual carrier-email lookup + send to the
 *     existing shared helper `sendTenderEmailIfAvailable`
 *     (`mobile/src/shared/services/tenderService.js`) — the same one
 *     the web TMS uses.
 *
 * The screen calls a single function and renders the result.
 */

import { sendTenderEmailIfAvailable } from '../shared/services/tenderService';
import type { ShipmentDetailViewModel } from './shipmentDetailService';

export interface TenderPayload {
  shipmentId: string;
  refNum: string;
  subject: string;
  origin: string;
  dest: string;
  pickup: string;
  delivery: string;
  mode: string;
  cost: string | number;
  weight: string | number;
  pieces: string | number;
  commodity: string;
  specialInstructions: string;
  dockDoor: string;
  dockTime: string;
  orderNumbers: string[];
  customerName: string;
}

export interface SendShipmentTenderResult {
  ok: boolean;
  sent: boolean;
  to: string;
  message: string;
}

/**
 * Build the request body for POST /api/tender/email from the
 * detail-screen view model. Field names match what server.js
 * actually reads — see the `b.dest`/`b.pickup`/`b.delivery` reads
 * around the `/api/tender/email` handler.
 *
 * `to`, `contactEmail`, `contactName`, `contactPhone` are deliberately
 * NOT set here: they are looked up by `sendTenderEmailIfAvailable`
 * from the carriers list and merged into the payload before the
 * actual fetch. Keeping the carrier-lookup in one place avoids the
 * "two parallel resolvers drift" problem (see memory: orders→DB
 * mappers).
 */
export function buildTenderPayload(
  vm: ShipmentDetailViewModel,
  shipment: any,
): TenderPayload {
  const idStr = String(vm.id || '');
  const numericPart = idStr.replace(/^SHP-/i, '');
  const refNum =
    'TND-' +
    numericPart +
    '-' +
    String(Math.floor(Math.random() * 9000 + 1000));

  const orderNumbers = Array.isArray(vm.linkedOrders)
    ? vm.linkedOrders
        .map((o: any) => o?.id)
        .filter((id: any) => typeof id === 'string' && id.length > 0)
    : [];

  const customerName = Array.isArray(vm.linkedOrders)
    ? Array.from(
        new Set(
          vm.linkedOrders
            .map((o: any) => o?.customer)
            .filter((c: any) => typeof c === 'string' && c.length > 0),
        ),
      ).join(', ')
    : '';

  // Prefer the view model (already normalized) but fall back to the
  // raw shipment row for fields the vm does not surface.
  const cost =
    shipment?.total_cost ??
    shipment?.cost ??
    (vm.cost && typeof vm.cost.total === 'number' ? vm.cost.total : '');

  return {
    shipmentId: idStr,
    refNum,
    subject: `Load Tender: ${idStr} — ${vm.origin} → ${vm.destination}`,
    origin: vm.origin || '',
    dest: vm.destination || '',
    pickup: vm.pickupDate || '',
    delivery: vm.deliveryDate || '',
    mode: vm.mode || '',
    cost,
    weight: vm.weight ?? '',
    pieces: vm.pieces ?? '',
    commodity: vm.commodity || '',
    specialInstructions: vm.notes || '',
    dockDoor: vm.dockDoor || '',
    dockTime: vm.dockTime || '',
    orderNumbers,
    customerName,
  };
}

/**
 * High-level send helper used by the screen. Returns a flat result
 * object the screen renders directly — no thrown exceptions for the
 * expected "no email on file" case (that is a user-actionable state,
 * not an error).
 */
export async function sendShipmentTender(args: {
  vm: ShipmentDetailViewModel;
  shipment: any;
  carriers: any[];
}): Promise<SendShipmentTenderResult> {
  const { vm, shipment, carriers } = args;

  if (!vm || !vm.id) {
    return {
      ok: false,
      sent: false,
      to: '',
      message: 'Shipment is not loaded — cannot send tender email.',
    };
  }

  const carrierName = vm.carrier || '';
  if (!carrierName || carrierName === '—') {
    return {
      ok: false,
      sent: false,
      to: '',
      message:
        'This shipment has no carrier assigned. Assign a carrier before sending the tender email.',
    };
  }

  const tenderPayload = buildTenderPayload(vm, shipment);

  let result: any;
  try {
    result = await sendTenderEmailIfAvailable({
      carriers: carriers || [],
      carrierName,
      tenderPayload,
    });
  } catch (err: any) {
    return {
      ok: false,
      sent: false,
      to: '',
      message: err?.message || 'Could not send tender email.',
    };
  }

  if (result && result.sent === true) {
    return {
      ok: true,
      sent: true,
      to: result.to || '',
      message: `Tender email sent to ${result.to || 'carrier'}.`,
    };
  }

  // Expected non-send paths
  if (result && result.reason === 'missing_email') {
    return {
      ok: false,
      sent: false,
      to: '',
      message: `No email on file for carrier "${carrierName}". Add a contact email on the Carriers screen, then retry.`,
    };
  }

  if (result && result.reason === 'smtp') {
    return {
      ok: false,
      sent: false,
      to: result.to || '',
      message:
        result.message ||
        'SMTP is not configured on the server. The tender was not emailed.',
    };
  }

  return {
    ok: false,
    sent: false,
    to: result?.to || '',
    message: result?.message || 'Tender email was not sent.',
  };
}
