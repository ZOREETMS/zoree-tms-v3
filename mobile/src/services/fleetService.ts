/**
 * Mobile fleet service — orchestration layer for driver and vehicle
 * mutations on the fleet screens.
 *
 * Pure service layer: calls DbApi, returns plain data, no React
 * state, no UI side-effects.
 *
 * Web parity reference:
 *   frontend/src/components/fleet/DriverModal.jsx (form shape)
 *   frontend/src/components/fleet/VehicleModal.jsx (form shape)
 *
 * Scope: drivers are fully CRUD-able since the backend has a real
 * /db/drivers endpoint. Vehicles only have mutations here (save /
 * delete) — there's no list endpoint yet, so the screen still seeds
 * the visible list from constants. When a vehicles list endpoint
 * lands, the same shape generalizes.
 */

import { DbApi } from '../lib/api';

/* ── Driver enums ────────────────────────────────────────────────── */

export const DRIVER_STATUSES = ['Available', 'On Duty', 'Off Duty', 'Inactive'] as const;
export const CDL_CLASSES = ['Class A', 'Class B', 'Class C', 'Non-CDL'] as const;
export const DRIVER_ENDORSEMENTS = [
  'Hazmat',
  'Tanker',
  'Doubles',
  'Reefer',
  'Flatbed',
  'Oversize',
  'Passenger',
] as const;

/* ── Driver form state ───────────────────────────────────────────── */

export interface DriverFormState {
  id: string;
  name: string;
  cdl: string;
  cdlClass: string;
  vehicle: string;
  location: string;
  status: string;
  hosToday: string;
  endorsements: string[];
  phone: string;
  email: string;
}

/** Fresh form for create. Uses a `DRV-NNN` style id like the seed data. */
export function buildBlankDriver(): DriverFormState {
  const seq = Math.floor(100 + Math.random() * 900);
  return {
    id: `DRV-${seq}`,
    name: '',
    cdl: '',
    cdlClass: 'Class A',
    vehicle: '',
    location: '',
    status: 'Available',
    hosToday: '0',
    endorsements: [],
    phone: '',
    email: '',
  };
}

/** Seed form state from an existing driver row (edit flow). */
export function buildDriverFormFromRow(driver: any): DriverFormState {
  if (!driver) return buildBlankDriver();
  const endorsementsRaw = driver.endorsements ?? [];
  const endorsements: string[] = Array.isArray(endorsementsRaw)
    ? endorsementsRaw
    : typeof endorsementsRaw === 'string'
      ? endorsementsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
  return {
    id: driver.id || '',
    name: driver.name || '',
    cdl: driver.cdl || driver.cdl_number || '',
    cdlClass: driver.cdlClass || driver.cdl_class || 'Class A',
    vehicle: driver.vehicle || driver.assigned_vehicle || '',
    location: driver.location || '',
    status: driver.status || 'Available',
    hosToday: driver.hosToday != null
      ? String(driver.hosToday)
      : driver.hos_today != null
        ? String(driver.hos_today)
        : '0',
    endorsements,
    phone: driver.phone || '',
    email: driver.email || '',
  };
}

/* ── Validation ──────────────────────────────────────────────────── */

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export function validateDriverForm(form: DriverFormState): ValidationResult {
  if (!form.id?.trim()) return { ok: false, error: 'Driver ID is required.' };
  if (!form.name?.trim()) return { ok: false, error: 'Driver name is required.' };
  if (!form.cdl?.trim()) return { ok: false, error: 'CDL number is required.' };
  return { ok: true };
}

/* ── Payload builders ────────────────────────────────────────────── */

/**
 * Build the database row from the form state. Numeric fields are
 * coerced; endorsements is persisted as a JSON array.
 */
export function buildDriverPayload(form: DriverFormState): Record<string, any> {
  return {
    id: form.id.trim(),
    name: form.name.trim(),
    cdl: form.cdl.trim(),
    cdl_class: form.cdlClass,
    vehicle: form.vehicle || null,
    location: form.location || null,
    status: form.status || 'Available',
    hos_today: parseFloat(form.hosToday) || 0,
    endorsements: form.endorsements,
    phone: form.phone || null,
    email: form.email || null,
  };
}

/* ── Driver mutations ────────────────────────────────────────────── */

/**
 * Save (create or update) a driver. Uses PATCH when an existing id
 * is supplied; otherwise upsert. Throws if validation fails so the
 * caller surfaces the message in a toast.
 */
export async function saveDriver(
  form: DriverFormState,
  isNew: boolean,
): Promise<any> {
  const v = validateDriverForm(form);
  if (!v.ok) throw new Error(v.error);
  const payload = buildDriverPayload(form);
  if (isNew) {
    return DbApi.upsert('drivers', payload);
  }
  return DbApi.patch('drivers', payload.id, payload);
}

/** Permanently delete a driver row. */
export async function deleteDriver(id: string): Promise<any> {
  if (!id) throw new Error('deleteDriver: id is required');
  return DbApi.remove('drivers', id);
}

/* ── Vehicle helpers (mutations only — no list endpoint yet) ─────── */

export const VEHICLE_STATUSES = ['Available', 'In Transit', 'Maintenance', 'Inactive'] as const;
export const VEHICLE_TYPES = [
  'Dry Van 53ft',
  'Dry Van 48ft',
  'Reefer 53ft',
  'Reefer 48ft',
  'Flatbed 53ft',
  'Flatbed 48ft',
  'Step Deck',
  'Tanker',
] as const;

export interface VehicleFormState {
  unit: string;
  type: string;
  driver: string;
  location: string;
  dest: string;
  nextPM: string;
  milesYTD: string;
  status: string;
}

export function buildBlankVehicle(): VehicleFormState {
  return {
    unit: '',
    type: 'Dry Van 53ft',
    driver: '',
    location: '',
    dest: '',
    nextPM: '',
    milesYTD: '0',
    status: 'Available',
  };
}

export function buildVehicleFormFromRow(vehicle: any): VehicleFormState {
  if (!vehicle) return buildBlankVehicle();
  return {
    unit: vehicle.unit || '',
    type: vehicle.type || 'Dry Van 53ft',
    driver: vehicle.driver || '',
    location: vehicle.location || '',
    dest: vehicle.dest || '',
    nextPM: vehicle.nextPM || vehicle.next_pm || '',
    milesYTD: vehicle.milesYTD != null
      ? String(vehicle.milesYTD)
      : vehicle.miles_ytd != null
        ? String(vehicle.miles_ytd)
        : '0',
    status: vehicle.status || 'Available',
  };
}

export function validateVehicleForm(form: VehicleFormState): ValidationResult {
  if (!form.unit?.trim()) return { ok: false, error: 'Unit number is required.' };
  if (!form.type?.trim()) return { ok: false, error: 'Vehicle type is required.' };
  return { ok: true };
}

export function buildVehiclePayload(form: VehicleFormState): Record<string, any> {
  return {
    unit: form.unit.trim(),
    type: form.type,
    driver: form.driver || null,
    location: form.location || null,
    dest: form.dest || null,
    next_pm: form.nextPM || null,
    miles_ytd: parseFloat(form.milesYTD) || 0,
    status: form.status || 'Available',
  };
}

export async function saveVehicle(
  form: VehicleFormState,
  isNew: boolean,
): Promise<any> {
  const v = validateVehicleForm(form);
  if (!v.ok) throw new Error(v.error);
  const payload = buildVehiclePayload(form);
  if (isNew) {
    return DbApi.upsert('vehicles', payload);
  }
  return DbApi.patch('vehicles', payload.unit, payload);
}

export async function deleteVehicle(unit: string): Promise<any> {
  if (!unit) throw new Error('deleteVehicle: unit is required');
  return DbApi.remove('vehicles', unit);
}
