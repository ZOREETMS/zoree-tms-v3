/**
 * Mobile dock scheduling service — appointment CRUD on the dock
 * scheduling screen.
 *
 * Web parity reference:
 *   frontend/src/services/dockScheduleService.js (warehouse config)
 *   frontend/src/components/dock-scheduling/AppointmentEditModal.jsx (form)
 *
 * The web app stores per-warehouse dock configuration in a separate
 * `warehouse_dock_config` table; mobile reads / writes appointments
 * (the `dock_appointments` table) and treats the door list as a
 * fixed constant (DOCK_DOORS) for now. Wiring per-warehouse config is
 * a separate, smaller follow-up.
 */

import { DbApi } from '../lib/api';

const TABLE = 'dock_appointments';

/* ── Constants (mirror web frontend/src/constants/docks.js) ──────── */

export const DOCK_DOORS = [
  'Door 1',
  'Door 2',
  'Door 3',
  'Door 4',
  'Door 5',
  'Door 6',
] as const;

export const DOCK_HOURS: string[] = Array.from({ length: 15 }, (_, i) => {
  const h = i + 6;
  return `${String(h).padStart(2, '0')}:00`;
});

export const APPT_TYPES = ['Outbound', 'Inbound', 'Cross-Dock'] as const;

export const APPT_STATUSES = [
  'Scheduled',
  'Confirmed',
  'In Progress',
  'Completed',
  'Cancelled',
] as const;

export const DURATION_OPTIONS: { value: number; label: string }[] = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 90, label: '90 min' },
  { value: 120, label: '2 hours' },
  { value: 150, label: '150 min' },
  { value: 180, label: '3 hours' },
];

/* ── Form state ──────────────────────────────────────────────────── */

export interface AppointmentFormState {
  id: string;
  type: string;
  door: string;
  date: string;
  start: string;
  duration: string;
  carrier: string;
  shipmentId: string;
  status: string;
  notes: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function buildBlankAppointment(): AppointmentFormState {
  return {
    id: '',
    type: 'Outbound',
    door: 'Door 1',
    date: todayIso(),
    start: '06:00',
    duration: '120',
    carrier: '',
    shipmentId: '',
    status: 'Scheduled',
    notes: '',
  };
}

export function buildAppointmentFormFromRow(row: any): AppointmentFormState {
  if (!row) return buildBlankAppointment();
  return {
    id: row.id || '',
    type: row.type || 'Outbound',
    door: row.door || 'Door 1',
    date: row.date || todayIso(),
    start: row.start || '06:00',
    duration: row.duration != null ? String(row.duration) : '120',
    carrier: row.carrier || '',
    shipmentId: row.shipmentId || row.shipment_id || '',
    status: row.status || 'Scheduled',
    notes: row.notes || '',
  };
}

/* ── Validation ──────────────────────────────────────────────────── */

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export function validateAppointmentForm(form: AppointmentFormState): ValidationResult {
  if (!form.type?.trim()) return { ok: false, error: 'Appointment type is required.' };
  if (!form.door?.trim()) return { ok: false, error: 'Dock door is required.' };
  if (!form.date) return { ok: false, error: 'Date is required.' };
  if (!form.start) return { ok: false, error: 'Start time is required.' };
  const dur = Number(form.duration);
  if (!Number.isFinite(dur) || dur <= 0 || dur > 600) {
    return { ok: false, error: 'Duration must be between 1 and 600 minutes.' };
  }
  return { ok: true };
}

/* ── Payload ─────────────────────────────────────────────────────── */

/**
 * Generate an id for a new appointment. Format `APPT-YYYYMMDD-NNNN` so
 * the id is sortable and visually identifies its day.
 */
export function generateAppointmentId(date: string = todayIso()): string {
  const compact = (date || todayIso()).replace(/-/g, '');
  const seq = Math.floor(1000 + Math.random() * 9000);
  return `APPT-${compact}-${seq}`;
}

export function buildAppointmentPayload(form: AppointmentFormState): Record<string, any> {
  return {
    id: form.id || generateAppointmentId(form.date),
    type: form.type,
    door: form.door,
    date: form.date,
    start: form.start,
    duration: Number(form.duration) || 120,
    carrier: form.carrier?.trim() || null,
    shipment_id: form.shipmentId?.trim() || null,
    status: form.status || 'Scheduled',
    notes: form.notes?.trim() || null,
  };
}

/* ── API ─────────────────────────────────────────────────────────── */

/** Fetch dock appointments. Optional date filter (`YYYY-MM-DD`). */
export async function fetchAppointments(date?: string): Promise<any[]> {
  try {
    const rows = await DbApi.dockAppointments(date);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function saveAppointment(form: AppointmentFormState): Promise<any> {
  const v = validateAppointmentForm(form);
  if (!v.ok) throw new Error(v.error);
  const payload = buildAppointmentPayload(form);
  return DbApi.upsert(TABLE, payload);
}

export async function deleteAppointment(id: string): Promise<any> {
  if (!id) throw new Error('deleteAppointment: id is required');
  return DbApi.remove(TABLE, id);
}

/* ── Grouping helpers ────────────────────────────────────────────── */

/**
 * Group appointments by dock door. Empty doors still appear in the
 * result so the screen can render every door consistently. Returns
 * tuples of `[door, list]` in DOCK_DOORS order.
 */
export function groupByDoor(
  appointments: any[],
  doors: ReadonlyArray<string> = DOCK_DOORS,
): Array<[string, any[]]> {
  const buckets: Record<string, any[]> = {};
  for (const d of doors) buckets[d] = [];
  for (const a of appointments || []) {
    const key = a?.door || 'Unassigned';
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(a);
  }
  // Sort each door's appointments by start time so the screen renders
  // chronologically without the caller having to re-sort.
  for (const d of Object.keys(buckets)) {
    buckets[d].sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));
  }
  // Preserve DOCK_DOORS order; append any non-canonical doors at the end.
  const ordered: Array<[string, any[]]> = doors.map((d) => [d, buckets[d] || []]);
  for (const k of Object.keys(buckets)) {
    if (!doors.includes(k as any)) ordered.push([k, buckets[k]]);
  }
  return ordered;
}

/** KPI summary used by the dock screen header. */
export function computeDockStats(appointments: any[]): {
  total: number;
  scheduled: number;
  inProgress: number;
  completed: number;
} {
  return {
    total: appointments.length,
    scheduled: appointments.filter((a) => a.status === 'Scheduled' || a.status === 'Confirmed').length,
    inProgress: appointments.filter((a) => a.status === 'In Progress').length,
    completed: appointments.filter((a) => a.status === 'Completed').length,
  };
}
