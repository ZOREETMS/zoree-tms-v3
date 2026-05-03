/**
 * Mobile shipment service - orchestration layer for manual shipment
 * create / copy / delete on the mobile shipments screens.
 *
 * Pure service layer: calls DbApi/ShipmentsApi, returns plain data,
 * no React state, no UI side-effects.
 */

import { DbApi, ShipmentsApi } from '../lib/api';

/**
 * Treat null/empty/whitespace as missing, otherwise return the
 * trimmed value. Used to scrub copy/create payloads before they hit
 * Supabase - Postgres rejects '' for date columns with a 400, which
 * is what surfaced as QA bug #56.
 */
function nullIfBlank(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/* ID + form helpers */

export function generateShipmentId(): string {
  return `SHP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

export interface ShipmentFormState {
  shipFromName: string;
  originCity: string;
  originState: string;
  originZip: string;
  shipToName: string;
  destCity: string;
  destState: string;
  destZip: string;
  mode: string;
  carrier: string;
  equipment: string;
  weight: string;
  pieces: string;
  total_cost: string;
  pickup_date: string;
  delivery_date: string;
  service_level: string;
  notes: string;
}

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

export function composeOriginDest(form: ShipmentFormState): { origin: string; dest: string } {
  const origin =
    [form.originCity, form.originState?.toUpperCase()].filter(Boolean).join(', ') +
    (form.originZip ? ' ' + form.originZip : '');
  const dest =
    [form.destCity, form.destState?.toUpperCase()].filter(Boolean).join(', ') +
    (form.destZip ? ' ' + form.destZip : '');
  return { origin, dest };
}

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

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export function validateShipmentForm(form: ShipmentFormState): ValidationResult {
  const { origin, dest } = composeOriginDest(form);
  if (!origin) return { ok: false, error: 'Origin city is required.' };
  if (!dest)   return { ok: false, error: 'Destination city is required.' };
  return { ok: true };
}

/* Mutations */

export async function createShipment(form: ShipmentFormState): Promise<any> {
  const id = generateShipmentId();
  const payload = { id, ...buildShipmentPayload(form) };
  await DbApi.upsert('shipments', payload);
  return payload;
}

/**
 * QA bug #56 fix: previously delivery_date: '' was sent which Postgres
 * rejects for date columns. nullIfBlank scrubs all optional values.
 */
export async function copyShipment(source: any): Promise<any> {
  if (!source || typeof source !== 'object') {
    throw new Error('copyShipment: source shipment is required');
  }
  const id = generateShipmentId();
  const today = new Date().toISOString().slice(0, 10);
  const copy: Record<string, any> = {
    id,
    origin: source.origin || '',
    dest: source.dest || '',
    origin_zip: nullIfBlank(source.origin_zip),
    dest_zip: nullIfBlank(source.dest_zip),
    ship_from_name: nullIfBlank(source.ship_from_name ?? source.shipFromName),
    ship_to_name: nullIfBlank(source.ship_to_name ?? source.shipToName),
    mode: source.mode || 'LTL',
    carrier: source.carrier || '',
    weight: Number(source.weight) || 0,
    pieces: parseInt(source.pieces, 10) || 0,
    total_cost: Number(source.total_cost) || 0,
    miles: Number(source.miles) || 0,
    rate: Number(source.rate) || 0,
    fuel_surcharge: Number(source.fuel_surcharge) || 0,
    accessorials: Number(source.accessorials) || 0,
    service_level: source.service_level || 'Standard',
    equipment: nullIfBlank(source.equipment),
    notes: source.notes || '',
    pickup_date: today,
    delivery_date: null,
    status: 'Planned',
  };
  await DbApi.upsert('shipments', copy);
  return copy;
}

/**
 * QA bug #57 fix: routed through ShipmentsApi.remove which goes to
 * /api/shipments/:id (server-side cascade) so linked orders flip
 * back to Unplanned with shipment_id=null.
 */
export async function deleteShipmentById(id: string): Promise<any> {
  if (!id) throw new Error('deleteShipmentById: id is required');
  return ShipmentsApi.remove(id);
}

/**
 * QA bug #63 fix: status update via the service-layer status endpoint
 * which validates against the canonical enum and runs the
 * shipment->order cascade in shipmentEvents.
 */
export async function updateShipmentStatus(id: string, status: string): Promise<any> {
  if (!id) throw new Error('updateShipmentStatus: id is required');
  if (!status) throw new Error('updateShipmentStatus: status is required');
  return ShipmentsApi.updateStatus(id, status);
}

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
