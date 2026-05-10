// ═══════════════════════════════════════════════════════════════════
// OfflineContext — REQ-OFFLINE Phase 5 (mobile, 2026-05-10).
//
// Single React Context that owns the offline-first surface area the
// rest of the app consumes:
//
//   • Reactive connectivity status (`isOnline`).
//   • Reactive write-queue counts (pendingCount, conflictCount).
//   • Last successful sync timestamp.
//   • An `enqueueWrite` helper screens call when offline.
//
// Owns the lifecycle of:
//   • lib/connectivity.init()/.destroy() — wire NetInfo once.
//   • services/offline/syncEngine.start()/.stop() — auto-drain on
//     reconnect.
//   • A periodic queue-count refresh (cheap SQL) so the UI badge
//     stays accurate after enqueue/drain without each screen having
//     to re-poll.
//
// Lifecycle: mount one OfflineProvider above DataProvider in App.tsx.
// Tear-down on unmount stops the engine and clears NetInfo.
// ═══════════════════════════════════════════════════════════════════

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as connectivity from '../lib/connectivity';
import * as syncEngine from '../services/offline/syncEngine';
import * as writeQueue from '../services/offline/writeQueue';
import type {
  EnqueueInput,
  QueueCounts,
  QueueEntry,
} from '../services/offline/writeQueue';

// ── Public types ────────────────────────────────────────────────────

export interface OfflineContextValue {
  /** True when the device reports network reachability. */
  isOnline: boolean;
  /** Pending writes (status = pending OR in_flight). UI badge source. */
  pendingCount: number;
  /** Conflicted writes that need user resolution. */
  conflictCount: number;
  /** Permanently failed writes (4xx, retry-budget exceeded). */
  failedCount: number;
  /** ISO timestamp of the last successful drain, or null. */
  lastSyncAt: string | null;
  /** Enqueue a write. Throws QueueFullError if the queue is saturated. */
  enqueueWrite: (input: EnqueueInput) => Promise<number>;
  /** List queued writes for a single entity (used by per-screen banners). */
  listQueuedFor: (entityType: 'order' | 'shipment', entityId: string) => Promise<QueueEntry[]>;
  /** Force an immediate drain (e.g. a "Sync now" button). No-op if offline. */
  drainNow: () => Promise<void>;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

// ── Provider ────────────────────────────────────────────────────────

const COUNTS_POLL_MS = 4000;
const EMPTY_COUNTS: QueueCounts = { pending: 0, inFlight: 0, conflict: 0, failed: 0, total: 0 };

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState<boolean>(false);
  const [counts, setCounts] = useState<QueueCounts>(EMPTY_COUNTS);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(syncEngine.getLastRunAt());

  // Stable ref to the latest counts so the drain listener can read
  // them without re-running useEffect every render.
  const mountedRef = useRef(true);

  // ── 1. Start connectivity + sync engine on mount ──────────────────
  useEffect(() => {
    mountedRef.current = true;
    connectivity.init();
    syncEngine.start();

    const unsubConn = connectivity.subscribe((snap) => {
      if (!mountedRef.current) return;
      setIsOnline(snap.isOnline);
    });

    const unsubEngine = syncEngine.onRunComplete(() => {
      if (!mountedRef.current) return;
      setLastSyncAt(syncEngine.getLastRunAt());
      refreshCounts();
    });

    return () => {
      mountedRef.current = false;
      unsubConn();
      unsubEngine();
      syncEngine.stop();
      connectivity.destroy();
    };
  }, []);

  // ── 2. Cheap periodic queue-count refresh ─────────────────────────
  //   The drain listener above already refreshes on drain, but an
  //   enqueue from a screen also needs the badge to update. We poll
  //   on a low frequency rather than threading a callback through
  //   every enqueueWrite call site.
  const refreshCounts = useCallback(async () => {
    try {
      const c = await writeQueue.counts();
      if (mountedRef.current) setCounts(c);
    } catch {
      /* SQLite hiccup; next tick will recover */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await refreshCounts();
    };
    tick();
    const handle = setInterval(tick, COUNTS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [refreshCounts]);

  // ── 3. Public helpers ─────────────────────────────────────────────

  const enqueueWrite = useCallback(async (input: EnqueueInput): Promise<number> => {
    const id = await writeQueue.enqueue(input);
    // Refresh counts immediately so the UI badge reflects the new entry
    // without waiting for the next poll tick.
    refreshCounts();
    return id;
  }, [refreshCounts]);

  const listQueuedFor = useCallback(
    (entityType: 'order' | 'shipment', entityId: string) =>
      writeQueue.listForEntity(entityType, entityId),
    [],
  );

  const drainNow = useCallback(async () => {
    if (!connectivity.isOnline()) return;
    await syncEngine.runOnce();
  }, []);

  // ── 4. Memoize the value so consumers re-render only on real changes
  const value = useMemo<OfflineContextValue>(() => ({
    isOnline,
    pendingCount:  counts.pending + counts.inFlight,
    conflictCount: counts.conflict,
    failedCount:   counts.failed,
    lastSyncAt,
    enqueueWrite,
    listQueuedFor,
    drainNow,
  }), [isOnline, counts, lastSyncAt, enqueueWrite, listQueuedFor, drainNow]);

  return (
    <OfflineContext.Provider value={value}>
      {children}
    </OfflineContext.Provider>
  );
}

// ── Hook ────────────────────────────────────────────────────────────

export function useOffline(): OfflineContextValue {
  const ctx = useContext(OfflineContext);
  if (!ctx) {
    throw new Error('useOffline must be used inside OfflineProvider');
  }
  return ctx;
}
