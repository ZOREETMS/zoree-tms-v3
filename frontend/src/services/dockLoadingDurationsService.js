/**
 * Dock Loading Durations Service
 *
 * Server state layer for the `dock_loading_durations` table (mode →
 * default loading window minutes). Keeps an in-memory cache so the
 * synchronous dock-assignment code path in dockService / ordersService
 * can read the current value without an async hop per shipment.
 *
 * Fallback policy:
 *   - Cache is seeded from LOAD_DURATION_BY_MODE at module load so the
 *     first call works even before the DB fetch completes.
 *   - If the fetch fails or returns an empty set, the constants remain
 *     authoritative — the feature degrades cleanly (matches the rollback
 *     plan in migration 011).
 *   - Rows with enabled=false are ignored (falls back to the constant
 *     for that mode).
 */

import { DbApi } from "../lib/api";
import { LOAD_DURATION_BY_MODE } from "../constants/docks";

let _cache = { ...LOAD_DURATION_BY_MODE };

function normalizeMode(mode) {
  return String(mode || "").toUpperCase().trim();
}

/**
 * Update the in-memory cache from a set of rows returned by the API.
 * Enabled rows override the constant; disabled rows fall back to it.
 */
export function setLoadDurationsCache(rows) {
  const next = { ...LOAD_DURATION_BY_MODE };
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r && r.enabled !== false && Number(r.duration_minutes) > 0) {
      next[normalizeMode(r.mode)] = Number(r.duration_minutes);
    }
  }
  _cache = next;
}

/**
 * Synchronous getter used by dockService / ordersService during planning.
 * @param {string} mode - "TL" / "LTL" / "Partial" / "Air"
 * @returns {number} minutes (never undefined)
 */
export function getLoadDuration(mode) {
  const key = normalizeMode(mode);
  return _cache[key] || _cache.TL || 120;
}

/**
 * Fetch the full list from the DB. Also refreshes the cache so any
 * subsequent getLoadDuration() call reflects the new values.
 */
export async function fetchDurations() {
  const rows = await DbApi.dockLoadingDurations();
  setLoadDurationsCache(rows);
  return Array.isArray(rows) ? rows : [];
}

/**
 * Patch a single row by mode (the PK). Updates the cache on success so
 * the admin's change is picked up immediately by in-progress planning.
 */
export async function updateDuration(mode, patch) {
  const row = await DbApi.patch("dock_loading_durations", mode, {
    ...patch,
    updated_at: new Date().toISOString(),
  });
  if (row && row.mode) {
    const key = normalizeMode(row.mode);
    if (row.enabled !== false && Number(row.duration_minutes) > 0) {
      _cache = { ..._cache, [key]: Number(row.duration_minutes) };
    } else {
      const next = { ..._cache };
      next[key] = LOAD_DURATION_BY_MODE[key] || next[key];
      _cache = next;
    }
  }
  return row;
}
