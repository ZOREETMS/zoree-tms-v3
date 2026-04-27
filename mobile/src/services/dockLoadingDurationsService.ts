/**
 * Mobile dock loading durations service — per-mode default loading
 * window minutes. Backs the admin row editor on the planning
 * parameters screen.
 *
 * Web parity reference: frontend/src/services/dockLoadingDurationsService.js.
 *
 * The web service maintains an in-memory cache so synchronous dock
 * assignment in ordersService can read the value without an async hop.
 * Mobile doesn't currently have that synchronous code path — when
 * dock assignment lands on mobile, port the cache layer at that time
 * (the shapes here already match).
 */

import { DbApi } from '../lib/api';

export interface DockDurationRow {
  mode: string;
  /** Display label (e.g. "Truckload"). May be absent on legacy rows. */
  label?: string;
  /** Default minutes for this mode. */
  duration_minutes: number;
  /** When false, the row is treated as "use the constant" by the planner. */
  enabled: boolean;
  updated_at?: string;
}

/** Allowed minute selections — matches the web `DURATION_OPTIONS`. */
export const DURATION_OPTIONS = [30, 60, 90, 120, 150, 180, 240, 300] as const;

function normalizeMode(mode: unknown): string {
  return String(mode || '').toUpperCase().trim();
}

/** Fetch all dock-duration rows. Returns [] on error so the screen renders. */
export async function fetchDurations(): Promise<DockDurationRow[]> {
  try {
    const rows = await DbApi.dockLoadingDurations();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export interface DurationPatch {
  duration_minutes?: number;
  enabled?: boolean;
}

/**
 * Validate a duration patch before sending it. Mirrors the web
 * range check (1–600 minutes). Pure helper, exported for tests.
 */
export function validateDurationPatch(patch: DurationPatch): { ok: boolean; error?: string } {
  if (patch.duration_minutes !== undefined) {
    const n = Number(patch.duration_minutes);
    if (!Number.isFinite(n) || n <= 0 || n > 600) {
      return { ok: false, error: 'Duration must be between 1 and 600 minutes.' };
    }
  }
  return { ok: true };
}

/**
 * Update a row by mode. Validates the payload, stamps updated_at,
 * and PATCHes the row.
 */
export async function updateDuration(
  mode: string,
  patch: DurationPatch,
): Promise<any> {
  const m = normalizeMode(mode);
  if (!m) throw new Error('updateDuration: mode is required');
  const v = validateDurationPatch(patch);
  if (!v.ok) throw new Error(v.error);
  return DbApi.patch('dock_loading_durations', m, {
    ...patch,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Synchronous lookup for a mode's current duration. The web's planner
 * uses this hot-path read; mobile calls fetchDurations once and then
 * uses this function on the result for cheap lookups during render.
 *
 * `defaultMinutes` is the fallback when the mode has no row or the row
 * is disabled. Web uses LOAD_DURATION_BY_MODE constants; mobile uses
 * 120 as the cross-mode default until those constants are ported.
 */
export function lookupDuration(
  rows: DockDurationRow[] | null | undefined,
  mode: string,
  defaultMinutes: number = 120,
): number {
  const m = normalizeMode(mode);
  const row = (rows || []).find((r) => normalizeMode(r.mode) === m);
  if (!row || row.enabled === false) return defaultMinutes;
  const n = Number(row.duration_minutes);
  return Number.isFinite(n) && n > 0 ? n : defaultMinutes;
}
