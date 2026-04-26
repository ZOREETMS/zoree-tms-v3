/**
 * Mobile equipment service — orchestration layer for the equipment
 * master (trailer types) used by rates / shipments / planning.
 *
 * Pure service layer: calls DbApi, returns plain data, no React
 * state, no UI side-effects.
 *
 * Web parity reference: frontend/src/services/equipmentService.js.
 *
 * Important integration: rateService.ts inlines a `SEED_EQUIPMENT`
 * fallback for the rate-form picker. With this service in place,
 * EditRateScreen / NewShipmentModal can prefer the DB list when
 * available and fall back to the seed list when the table is empty
 * (matching how the web equipmentService.getEquipmentList behaves).
 */

import { DbApi } from '../lib/api';

const TABLE = 'equipment_types';

/**
 * Seed catalog used when the equipment_types table is empty (fresh
 * tenant or preview build with no backend data). Mirrors the web
 * SEED_EQUIPMENT shape exactly so the planner sees identical rows
 * in both places.
 */
export const SEED_EQUIPMENT = [
  { id: 'EQ-001', name: 'Dry Van 53ft', code: 'DV53', description: 'Standard 53ft dry van trailer', max_weight: 45000, max_volume: 3800, length: 53, width: 8.5, height: 9, temp_controlled: false, hazmat_certified: false, status: 'Active' },
  { id: 'EQ-002', name: 'Dry Van 48ft', code: 'DV48', description: 'Standard 48ft dry van trailer', max_weight: 44000, max_volume: 3400, length: 48, width: 8.5, height: 9, temp_controlled: false, hazmat_certified: false, status: 'Active' },
  { id: 'EQ-003', name: 'Reefer 53ft', code: 'RF53', description: '53ft refrigerated trailer', max_weight: 43000, max_volume: 3600, length: 53, width: 8.5, height: 9, temp_controlled: true, hazmat_certified: false, status: 'Active' },
  { id: 'EQ-004', name: 'Reefer 48ft', code: 'RF48', description: '48ft refrigerated trailer', max_weight: 42000, max_volume: 3200, length: 48, width: 8.5, height: 9, temp_controlled: true, hazmat_certified: false, status: 'Active' },
  { id: 'EQ-005', name: 'Flatbed 53ft', code: 'FB53', description: '53ft flatbed trailer', max_weight: 48000, max_volume: 0, length: 53, width: 8.5, height: 0, temp_controlled: false, hazmat_certified: false, status: 'Active' },
  { id: 'EQ-006', name: 'Flatbed 48ft', code: 'FB48', description: '48ft flatbed trailer', max_weight: 47000, max_volume: 0, length: 48, width: 8.5, height: 0, temp_controlled: false, hazmat_certified: false, status: 'Active' },
  { id: 'EQ-007', name: 'LTL', code: 'LTL', description: 'Less-than-truckload shared trailer', max_weight: 20000, max_volume: 2000, length: 53, width: 8.5, height: 9, temp_controlled: false, hazmat_certified: false, status: 'Active' },
  { id: 'EQ-008', name: 'Step Deck', code: 'SD48', description: '48ft step deck trailer', max_weight: 43000, max_volume: 0, length: 48, width: 8.5, height: 10, temp_controlled: false, hazmat_certified: false, status: 'Active' },
  { id: 'EQ-009', name: 'Tanker', code: 'TANK', description: 'Liquid bulk tanker trailer', max_weight: 45000, max_volume: 6800, length: 42, width: 8, height: 0, temp_controlled: false, hazmat_certified: true, status: 'Active' },
  { id: 'EQ-010', name: 'Intermodal Container 40ft', code: 'IM40', description: '40ft intermodal shipping container', max_weight: 44800, max_volume: 2350, length: 40, width: 8, height: 8.5, temp_controlled: false, hazmat_certified: false, status: 'Active' },
  { id: 'EQ-011', name: 'Sprinter Van', code: 'SPRN', description: 'Sprinter/cargo van for small shipments', max_weight: 3500, max_volume: 400, length: 12, width: 6, height: 6, temp_controlled: false, hazmat_certified: false, status: 'Active' },
  { id: 'EQ-012', name: 'Straight Truck 26ft', code: 'ST26', description: '26ft box truck / straight truck', max_weight: 10000, max_volume: 1500, length: 26, width: 8, height: 8, temp_controlled: false, hazmat_certified: false, status: 'Active' },
];

/* ── Form state ──────────────────────────────────────────────────── */

export interface EquipmentFormState {
  id: string;
  name: string;
  code: string;
  description: string;
  status: string;
  max_weight: string;
  max_volume: string;
  length: string;
  width: string;
  height: string;
  temp_controlled: boolean;
  hazmat_certified: boolean;
}

export const EQUIPMENT_STATUSES = ['Active', 'Inactive'] as const;

export function buildBlankEquipment(): EquipmentFormState {
  return {
    id: '',
    name: '',
    code: '',
    description: '',
    status: 'Active',
    max_weight: '',
    max_volume: '',
    length: '',
    width: '',
    height: '',
    temp_controlled: false,
    hazmat_certified: false,
  };
}

export function buildEquipmentFormFromRow(row: any): EquipmentFormState {
  if (!row) return buildBlankEquipment();
  return {
    id: row.id || '',
    name: row.name || '',
    code: row.code || '',
    description: row.description || '',
    status: row.status || 'Active',
    max_weight: row.max_weight != null ? String(row.max_weight) : '',
    max_volume: row.max_volume != null ? String(row.max_volume) : '',
    length: row.length != null ? String(row.length) : '',
    width: row.width != null ? String(row.width) : '',
    height: row.height != null ? String(row.height) : '',
    temp_controlled: !!row.temp_controlled,
    hazmat_certified: !!row.hazmat_certified,
  };
}

/* ── Validation ──────────────────────────────────────────────────── */

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export function validateEquipmentForm(form: EquipmentFormState): ValidationResult {
  if (!form.name?.trim()) return { ok: false, error: 'Equipment name is required.' };
  return { ok: true };
}

/* ── Payload ─────────────────────────────────────────────────────── */

/**
 * Build the DB row from form state. Mirrors the web's `buildPayload`:
 * autogenerates an id when missing, parses numeric fields, persists
 * unchecked flags as `false` (not omitted) so PATCHes don't leave a
 * stale `true` lingering on the row.
 */
export function buildEquipmentPayload(form: EquipmentFormState): Record<string, any> {
  return {
    id: form.id || `EQ-${Date.now().toString(36).toUpperCase()}`,
    name: form.name.trim(),
    code: form.code?.trim() || null,
    description: form.description || null,
    status: form.status || 'Active',
    max_weight: parseFloat(form.max_weight) || 0,
    max_volume: parseFloat(form.max_volume) || 0,
    length: parseFloat(form.length) || 0,
    width: parseFloat(form.width) || 0,
    height: parseFloat(form.height) || 0,
    temp_controlled: !!form.temp_controlled,
    hazmat_certified: !!form.hazmat_certified,
  };
}

/* ── List + lookup ───────────────────────────────────────────────── */

/**
 * Resolve an equipment list — DB rows when the master table has data,
 * otherwise the seed catalog. Mirrors the web's
 * `equipmentService.getEquipmentList` so any caller that previously
 * relied on the seed-only fallback gets API data automatically.
 */
export function getEquipmentList(equipmentTypes?: any[]): any[] {
  return equipmentTypes && equipmentTypes.length > 0 ? equipmentTypes : SEED_EQUIPMENT;
}

/* ── Mutations ───────────────────────────────────────────────────── */

/** Save (create or update) an equipment row. */
export async function saveEquipment(form: EquipmentFormState): Promise<any> {
  const v = validateEquipmentForm(form);
  if (!v.ok) throw new Error(v.error);
  const payload = buildEquipmentPayload(form);
  // The web uses `upsert` for both create and update — the backend
  // /db/:table endpoint handles either based on whether the row id
  // already exists. We mirror that here.
  return DbApi.upsert(TABLE, payload);
}

/**
 * Soft-delete: set status to Inactive. Mirrors the web's
 * `deactivateEquipment` so we don't lose history.
 */
export async function deactivateEquipment(id: string): Promise<any> {
  if (!id) throw new Error('deactivateEquipment: id is required');
  return DbApi.patch(TABLE, id, { status: 'Inactive' });
}

/** Hard delete — for typo'd test rows the user really wants gone. */
export async function deleteEquipment(id: string): Promise<any> {
  if (!id) throw new Error('deleteEquipment: id is required');
  return DbApi.remove(TABLE, id);
}

/* ── Stats ───────────────────────────────────────────────────────── */

export interface EquipmentStats {
  total: number;
  active: number;
  inactive: number;
  refrigerated: number;
  hazmat: number;
}

export function computeEquipmentStats(list: any[]): EquipmentStats {
  return {
    total: list.length,
    active: list.filter((e) => (e.status || 'Active') === 'Active').length,
    inactive: list.filter((e) => e.status === 'Inactive').length,
    refrigerated: list.filter((e) => e.temp_controlled).length,
    hazmat: list.filter((e) => e.hazmat_certified).length,
  };
}
