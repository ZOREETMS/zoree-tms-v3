// ═══════════════════════════════════════════════════════════════════
// MW Queue Service — UI-facing wrapper around MwQueueApi
//
// CLAUDE_RULES §3, §4: keeps the React layer free of direct fetch()
// and lets us shape the API response into a UI-friendly view-model
// (formatted timestamps, derived "stale?" flag, cleaned summary text).
// Components and hooks call this; never the raw API.
// ═══════════════════════════════════════════════════════════════════

import { MwQueueApi } from "../lib/api";

/**
 * Format an ISO timestamp into a short "HH:MM:SS" / "—" view value.
 * Kept here so the UI never re-parses dates inline.
 */
function formatTimeOfDay(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-US", {
    hour:   "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Compute "seconds since last run" so the UI can flag a stuck worker.
 * Returns null when no run has happened yet.
 */
function secondsSinceLastRun(lastRunAtIso) {
  if (!lastRunAtIso) return null;
  const t = new Date(lastRunAtIso).getTime();
  if (isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

/**
 * Shape the raw status response into a view model. The UI component
 * binds directly to these fields — no in-component transforms.
 */
function shapeStatus(raw) {
  const r = raw || {};
  const lastRunSec = secondsSinceLastRun(r.lastRunAt);
  return {
    running:        !!r.running,
    intervalMs:     Number(r.intervalMs) || 5000,
    inFlight:       !!r.inFlight,
    lastRunAtIso:   r.lastRunAt || null,
    lastRunAtLabel: formatTimeOfDay(r.lastRunAt),
    secondsSince:   lastRunSec,
    // "Stale" = running but hasn't ticked in 3× the configured interval.
    // Surfaces a worker that's wedged on a single handler.
    isStale:
      !!r.running &&
      lastRunSec !== null &&
      lastRunSec * 1000 > 3 * (Number(r.intervalMs) || 5000),
    lastResult:     r.lastResult || null,
    lastError:      r.lastError  || null,
  };
}

/** Fetch + shape current worker status. */
export async function getStatus() {
  const raw = await MwQueueApi.status();
  return shapeStatus(raw);
}

/** Begin the periodic drain. intervalMs is optional. */
export async function startWorker(intervalMs) {
  const raw = await MwQueueApi.start(intervalMs);
  return shapeStatus(raw);
}

/** Halt the periodic drain. */
export async function stopWorker() {
  const raw = await MwQueueApi.stop();
  return shapeStatus(raw);
}

/**
 * Drain a single batch on demand. Returns { summary, status }
 * where summary is { processed, errors, skipped, ids } and status
 * is the shaped post-run state.
 */
export async function runOnce() {
  const raw = await MwQueueApi.runOnce();
  return {
    summary: raw && raw.summary ? raw.summary : { processed: 0, errors: 0, skipped: 0, ids: [] },
    status:  shapeStatus(raw && raw.status),
  };
}
