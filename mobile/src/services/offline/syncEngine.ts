// ═══════════════════════════════════════════════════════════════════
// syncEngine — REQ-OFFLINE Phase 5 (mobile, 2026-05-10).
//
// Drains the offline write_queue when the device comes back online.
// Sequence per queued entry:
//
//   1. Mark in_flight (takeNextPending does this atomically).
//   2. Resolve: fetch the current server row and check base_version.
//        ─ 'replay'   → send the write, drop the queue entry.
//        ─ 'conflict' → mark conflict; surface to UI.
//        ─ 'skip'     → leave pending (network blip during resolve).
//   3. On replay success: write the server response back to the
//      relevant repo cache so the next render shows the
//      authoritative copy.
//
// Concurrency: the engine takes one entry at a time. We don't
// parallelize because audit ordering matters (REQ-02) — a status
// update that flips Tendered→Tender Accepted before another
// status flip Tender Accepted→In Transit must hit the server in
// order. A single in-flight slot keeps the audit timeline coherent.
//
// Public surface
// ──────────────
//   runOnce()    — drain whatever's currently pending. Stops when
//                   the queue is empty or connectivity drops.
//                   Returns a summary of what happened.
//   start()      — auto-run on every 'online' transition.
//                   Idempotent — calling start() twice is a no-op.
//                   Pairs with stop() for clean teardown.
//   stop()       — disable auto-run.
//
// Caller responsibility
// ─────────────────────
// runOnce() and start() do NOT call setInterval. Polling is
// connectivity-driven (subscribe to connectivity), not time-driven.
// The OfflineProvider in state/OfflineContext.tsx is the only place
// start()/stop() should be invoked.
// ═══════════════════════════════════════════════════════════════════

import { isOnline, subscribe as subscribeConnectivity } from '../../lib/connectivity';
import * as writeQueue from './writeQueue';
import * as conflictResolver from './conflictResolver';
import * as ordersRepo from './ordersRepo';
import * as shipmentsRepo from './shipmentsRepo';

// ── Public types ────────────────────────────────────────────────────

export interface RunSummary {
  attempted: number;
  replayed: number;
  conflicts: number;
  failed: number;
  skipped: number;
}

const ZERO: RunSummary = { attempted: 0, replayed: 0, conflicts: 0, failed: 0, skipped: 0 };

// ── Module-singleton state ──────────────────────────────────────────

let _running = false;
let _unsubConnectivity: (() => void) | null = null;
let _lastRunAt: string | null = null;
let _runListeners: Set<(s: RunSummary) => void> = new Set();

function notifyRun(summary: RunSummary): void {
  for (const cb of Array.from(_runListeners)) {
    try { cb(summary); } catch { /* listener errors must not break the engine */ }
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Drain everything currently pending. Returns when the queue is empty
 * or the device goes offline mid-drain.
 *
 * Safe to call concurrently — a second call while one is running
 * returns the in-flight promise (no double-drain).
 */
export async function runOnce(): Promise<RunSummary> {
  if (_running) return ZERO; // ← caller doesn't await the same drain twice
  _running = true;
  const summary: RunSummary = { ...ZERO };
  try {
    // Re-attempt orphans from a previous lifecycle exactly once per
    // drain — cheap to call repeatedly, but limiting it to drain
    // entry keeps the SQL traffic predictable.
    await writeQueue.reclaimOrphans();

    while (isOnline()) {
      const entry = await writeQueue.takeNextPending();
      if (!entry) break;
      summary.attempted += 1;

      let outcome: conflictResolver.ResolverOutcome;
      try {
        outcome = await conflictResolver.resolve(entry);
      } catch (e: any) {
        await writeQueue.markRetry(entry.id, e?.message || 'resolve error');
        summary.skipped += 1;
        continue;
      }

      if (outcome.decision === 'conflict') {
        await writeQueue.markConflict(entry.id, outcome.reason || 'conflict detected');
        summary.conflicts += 1;
        // Still refresh the cache with the server's view so the UI
        // shows the authoritative row even though our edit lost.
        if (outcome.serverRow) {
          await writeRepoFromOutcome(entry.entityType, outcome.serverRow);
        }
        continue;
      }

      if (outcome.decision === 'skip') {
        await writeQueue.markRetry(entry.id, outcome.reason || 'transient error');
        summary.skipped += 1;
        // Don't keep hammering the network if we've stopped being online.
        if (!isOnline()) break;
        continue;
      }

      // outcome.decision === 'replay'
      try {
        const serverResp = await conflictResolver.replay(entry);
        await writeQueue.remove(entry.id);
        summary.replayed += 1;
        if (serverResp && typeof serverResp === 'object') {
          await writeRepoFromOutcome(entry.entityType, serverResp);
        }
      } catch (e: any) {
        const msg = e?.message || 'replay failed';
        // 409 Conflict from the server (rare — the resolver should
        // catch most of these). Treat as a conflict to be safe.
        const status = e?.status ?? e?.response?.status;
        if (status === 409) {
          await writeQueue.markConflict(entry.id, msg);
          summary.conflicts += 1;
        } else if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
          // 4xx other than the transient ones → don't retry forever.
          await writeQueue.markFailed(entry.id, msg);
          summary.failed += 1;
        } else {
          await writeQueue.markRetry(entry.id, msg);
          summary.skipped += 1;
          if (!isOnline()) break;
        }
      }
    }

    _lastRunAt = new Date().toISOString();
    notifyRun(summary);
    return summary;
  } finally {
    _running = false;
  }
}

/**
 * Enable auto-drain: subscribe to connectivity transitions and call
 * runOnce() whenever the device comes online. Idempotent.
 */
export function start(): void {
  if (_unsubConnectivity) return;
  _unsubConnectivity = subscribeConnectivity((snap) => {
    if (snap.isOnline) {
      // Fire-and-forget — caller doesn't await the drain.
      runOnce().catch((err) => {
        if (__DEV__) console.warn('[syncEngine] drain failed:', err?.message);
      });
    }
  });
}

/** Disable auto-drain. Use from logout / app teardown / tests. */
export function stop(): void {
  if (_unsubConnectivity) {
    _unsubConnectivity();
    _unsubConnectivity = null;
  }
}

/** ISO timestamp of the most recent drain, or null. */
export function getLastRunAt(): string | null {
  return _lastRunAt;
}

/** Subscribe to run completions. Returns unsubscribe. */
export function onRunComplete(cb: (s: RunSummary) => void): () => void {
  _runListeners.add(cb);
  return () => { _runListeners.delete(cb); };
}

// ── Internal helpers ────────────────────────────────────────────────

async function writeRepoFromOutcome(entityType: string, serverRow: any): Promise<void> {
  try {
    if (entityType === 'order')    await ordersRepo.primeFromServer([serverRow]);
    if (entityType === 'shipment') await shipmentsRepo.primeFromServer([serverRow]);
  } catch (e: any) {
    if (__DEV__) console.warn('[syncEngine] cache write failed:', e?.message);
  }
}

// ── Test-only internal handles ──────────────────────────────────────

export const _internal = {
  /** Reset module-singleton state. Tests only. */
  __testReset: (): void => {
    stop();
    _running = false;
    _lastRunAt = null;
    _runListeners = new Set();
  },
  isRunning: (): boolean => _running,
};
