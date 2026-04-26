/**
 * Mobile shipment service — orchestration layer for manual shipment
 * create / copy / delete on the mobile shipments screens.
 *
 * Pure service layer: calls DbApi, returns plain data, no React
 * state, no UI side-effects.
 *
 * Web parity reference: frontend/src/services/shipmentService.js.
 * Mobile keeps the form state shape simpler than web (plain
 * city/state/zip strings instead of the canonical Location type) —
 * the boundary mapping into DB columns happens in `buildShipmentPayload`.
 */

import { DbApi } from '../lib/api';

/* ── ID + form helpers ────────────────────────────────────────────── */

/** Generate a unique shipment id (`SHP-YYYY-NNNN`). */
export function generateShipmentId(): string {
  return `SHP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

export interface ShipmentFormState {
  // Origin location
  shipFromName: string;
  originCity: string;
  originState: string;
  originZip: string;
  // Destination location
  shipToName: string;
  destCity: string;
  destState: string;
  destZip: string;
  // Mode + carrier
  mode: string;
  carrier: string;
  equipment: string;
  // Freight
  weight: string;
  pieces: string;
  total_cost: string;
  // Dates
  pickup_date: string;
  delivery_date: string;
  // Service + notes
  service_level: string;
  notes: string;
}

/**
 * Blank form state used by the create modal. Mirrors the shape
 * `frontend/src/services/shipmentService.js → buildBlankShipment`
 * produces, but stays string-shaped for predictable mobile inputs.
 */
export function buildBlankShipment(): ShipmentFormState {
  return {
    shipFromName: '',
    originCity: '',
    originState: '',
    originZip: '',
    shipToName: '',
    destCity: '',
    destState: '',
    destZip: '',
    mode: 'LTL',
    carrier: '',
    equipment: '',
    weight: '',
    pieces: '',
    total_cost: '',
    pickup_date: new Date().toISOString().slice(0, 10),
    delivery_date: '',
    service_level: 'Standard',
    notes: '',
  };
}

/**
 * Compose origin / dest free-text strings from city/state/zip parts —
 * matches the format produced by the web's NewShipmentModal so a
 * shipment created on mobile reads identically on web.
 */
export function composeOriginDest(form: ShipmentFormState): { origin: string; dest: string } {
  const origin =
    [form.originCity, form.originState?.toUpperCase()].filter(Boolean).join(', ') +
    (form.originZip ? ' ' + form.originZip : '');
  const dest =
    [form.destCity, form.destState?.toUpperCase()].filter(Boolean).join(', ') +
    (form.destZip ? ' ' + form.destZip : '');
  return { origin, dest };
}

/**
 * Build the database row from the form state. Pulled out of
 * `createShipment` so tests can assert the shape without mocking
 * network calls and so future call sites (e.g. an edit flow) can
 * reuse the field-mapping logic.
 */
export function buildShipmentPayload(form: ShipmentFormState): Record<string, any> {
  const { origin, dest } = composeOriginDest(form);
  const equipmentRaw = (form.equipment || '').trim();
  return {
    origin,
    dest,
    origin_zip: form.originZip || null,
    dest_zip: form.destZip || null,
    ship_from_name: form.shipFromName || null,
    ship_to_name: form.shipToName || null,
    mode: form.mode || 'LTL',
    carrier: form.carrier || '',
    equipment: equipmentRaw || null,
    weight: parseFloat(form.weight) || 0,
    pieces: parseInt(form.pieces, 10) || 0,
    total_cost: parseFloat(form.total_cost) || 0,
    pickup_date: form.pickup_date || null,
    delivery_date: form.delivery_date || null,
    service_level: form.service_level || 'Standard',
    notes: form.notes || '',
    status: 'Planned',
  };
}

/* ── Validation ───────────────────────────────────────────────────── */

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * Pre-save check. The web modal enforces origin + dest only;
 * mobile follows the same rule so a shipment created here doesn't
 * have to round-trip through validation that the web wouldn't apply.
 */
export function validateShipmentForm(form: ShipmentFormState): ValidationResult {
  const { origin, dest } = composeOriginDest(form);
  if (!origin) return { ok: false, error: 'Origin city is required.' };
  if (!dest)   return { ok: false, error: 'Destination city is required.' };
  return { ok: true };
}

/* ── Mutations ────────────────────────────────────────────────────── */

/**
 * Create a new shipment from the form state. Generates the id,
 * normalizes numeric fields, and writes the row via DbApi.upsert.
 * Returns the created shipment so the caller can update local cache
 * without re-fetching.
 */
export async function createShipment(form: ShipmentFormState): Promise<any> {
  const id = generateShipmentId();
  const payload = { id, ...buildShipmentPayload(form) };
  await DbApi.upsert('shipments', payload);
  return payload;
}

/**
 * Copy an existing shipment with a new id and reset status. Mirrors
 * web `copyShipment`: drops order_ids / bol fields / tender state so
 * the copy is a fresh planning candidate, not a tied-back duplicate.
 */
export async function copyShipment(source: any): Promise<any> {
  if (!source || typeof source !== 'object') {
    throw new Error('copyShipment: source shipment is required');
  }
  const id = generateShipmentId();
  const today = new Date().toISOString().slice(0, 10);
  const copy = {
    id,
    origin: source.origin || '',
    dest: source.dest || '',
    origin_zip: source.origin_zip || null,
    dest_zip: source.dest_zip || null,
    ship_from_name: source.ship_from_name || null,
    ship_to_name: source.ship_to_name || null,
    mode: source.mode || 'LTL',
    carrier: source.carrier || '',
    weight: source.weight || 0,
    pieces: source.pieces || 0,
    total_cost: source.total_cost || 0,
    miles: source.miles || 0,
    rate: source.rate || 0,
    fuel_surcharge: source.fuel_surcharge || 0,
    service_level: source.service_level || 'Standard',
    equipment: source.equipment ?? null,
    notes: source.notes || '',
    pickup_date: today,
    delivery_date: '',
    status: 'Planned',
    // intentionally NOT copied: order_ids, bol_type / bol_number,
    // master_shipment_id, tender_* — see web copyShipment for rationale.
  };
  await DbApi.upsert('shipments', copy);
  return copy;
}

/** Permanently delete a shipment row. */
export async function deleteShipmentById(id: string): Promise<any> {
  if (!id) throw new Error('deleteShipmentById: id is required');
  return DbApi.remove('shipments', id);
}

/**
 * Resolve the trailer/equipment to display for a shipment, falling
 * back to the source rate when the shipment row was planned before
 * migration 025 carried equipment forward.
 *
 * Web parity reference: shipmentService.deriveShipmentEquipment.
 * Pure helper — no I/O — so it composes cleanly into list/detail
 * render code.
 */
export function deriveShipmentEquipment(
  shipment: any,
  rateRow: any,
): { value: string | null; source: 'shipment' | 'rate' | null } {
  const stored =
    shipment && typeof shipment.equipment === 'string'
      ? shipment.equipment.trim()
      : '';
  if (stored) return { value: stored, source: 'shipment' };

  const fromRate =
    rateRow && typeof rateRow.equipment === 'string'
      ? rateRow.equipment.trim()
      : '';
  if (fromRate) return { value: fromRate, source: 'rate' };

  return { value: null, source: null };
}
