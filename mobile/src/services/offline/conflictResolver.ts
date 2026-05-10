// ═══════════════════════════════════════════════════════════════════
// conflictResolver — REQ-OFFLINE Phase 5 (mobile, 2026-05-10).
//
// Server-wins policy. Before replaying a queued write the resolver
// fetches the current server row and compares `updated_at` against
// the `base_version` captured at enqueue time:
//
//   ─ base_version matches      → safe to replay, server hasn't moved on
//   ─ base_version differs      → conflict; the user's edit would
//                                  silently overwrite a fresh server
//                                  change. Drop the write and surface
//                                  the conflict to the UI.
//   ─ no base_version captured  → skip the check; replay
//                                  unconditionally. This applies to
//                                  'create' (no prior row) and to any
//                                  entry that was enqueued before
//                                  base_version capture was wired in.
//
// We deliberately do NOT diff the user's payload against the server
// row to look for per-field conflicts — the audit explicitly chose
// server-wins for TMS, with the trade-off accepted that any conflict
// loses the user's edit. Loss-vs-corruption is the correct trade for
// audit-critical entities (status, carrier, tender state).
//
// Successful resolution returns a {decision} of 'replay'; conflicts
// return 'conflict' with a human-readable reason. The syncEngine
// stamps the queue entry status accordingly.
// ═══════════════════════════════════════════════════════════════════

// @ts-expect-error — shared/api.js is JS, no .d.ts.
import { OrdersApi, ShipmentsApi } from '../../lib/api';
import type { QueueEntry } from './writeQueue';

// ── Public types ────────────────────────────────────────────────────

export type ResolverDecision = 'replay' | 'conflict' | 'skip';

export interface ResolverOutcome {
  decision: ResolverDecision;
  /** Human-readable reason. Surfaced verbatim in the UI for conflicts. */
  reason?: string;
  /** Latest server row, if we fetched it. Lets the caller refresh the cache. */
  serverRow?: any;
}

// ── Fetchers (one per entity) ──────────────────────────────────────

/**
 * Pull a single row from the server. Returns null if the row has
 * been deleted server-side (404). Throws on any other error so the
 * caller can decide between retry and conflict.
 *
 * NOTE: relies on OrdersApi.full / ShipmentsApi.get from
 * mobile/src/shared/api.js. If those endpoints ever change name the
 * fetcher needs updating in lockstep.
 */
async function fetchCurrent(entry: QueueEntry): Promise<any | null> {
  if (entry.entityType === 'order') {
    try {
      return await OrdersApi.full(entry.entityId);
    } catch (e: any) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }
  if (entry.entityType === 'shipment') {
    try {
      return await ShipmentsApi.get(entry.entityId);
    } catch (e: any) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }
  throw new Error(`Unknown entity type '${entry.entityType}'`);
}

function isNotFound(e: any): boolean {
  if (!e) return false;
  const status = e.status ?? e.code ?? e.response?.status;
  if (status === 404) return true;
  const msg = String(e.message || '').toLowerCase();
  return msg.includes('not found') || msg.includes('404');
}

// ── Version extraction ──────────────────────────────────────────────

/**
 * Extract the comparable version string from a server row. We default
 * to `updated_at` (the canonical column on orders + shipments) and
 * fall back to the raw row reference as JSON for tables that don't
 * track it. Captured at enqueue time and at replay time using the
 * same function so the comparison is symmetric.
 */
export function versionOf(row: any): string | null {
  if (!row || typeof row !== 'object') return null;
  if (typeof row.updated_at === 'string') return row.updated_at;
  if (typeof row.updatedAt === 'string')  return row.updatedAt;
  return null;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Decide what to do with a queued write before sending it.
 *
 * Sequence:
 *   1. Fetch the current server row.
 *   2. If the row is gone (404):
 *      a) For 'delete' — already done, mark as 'replay' so the caller
 *         can drop the queue entry without sending anything.
 *      b) For 'status' / 'patch' — the user tried to edit a row that's
 *         since been deleted. Surface as conflict.
 *   3. If we have a base_version and it doesn't match the server's
 *      current version → conflict.
 *   4. Otherwise → replay.
 */
export async function resolve(entry: QueueEntry): Promise<ResolverOutcome> {
  let serverRow: any = null;
  try {
    serverRow = await fetchCurrent(entry);
  } catch (e: any) {
    // Network error — the syncEngine will retry. Treat as 'skip' so
    // the queue entry stays pending rather than escalating to conflict.
    return { decision: 'skip', reason: `Could not reach server: ${e?.message || 'network error'}` };
  }

  if (serverRow === null) {
    if (entry.operation === 'delete') {
      // Idempotency: the row is already gone. Treat as a no-op replay.
      return { decision: 'replay', serverRow: null };
    }
    return {
      decision: 'conflict',
      reason: `${pretty(entry.entityType)} ${entry.entityId} was deleted on the server before your change could sync.`,
      serverRow: null,
    };
  }

  if (entry.baseVersion) {
    const current = versionOf(serverRow);
    if (current && current !== entry.baseVersion) {
      return {
        decision: 'conflict',
        reason: `${pretty(entry.entityType)} ${entry.entityId} was updated on the server while you were offline; your change was not applied.`,
        serverRow,
      };
    }
  }

  return { decision: 'replay', serverRow };
}

// ── Replay helpers (one per operation) ──────────────────────────────

/**
 * Actually send a queued write to the server. Caller is responsible
 * for running {@link resolve} first and only invoking this when the
 * decision is 'replay'.
 *
 * Returns the server's response so the caller can refresh the local
 * cache from the authoritative copy.
 */
export async function replay(entry: QueueEntry): Promise<any> {
  const api = entry.entityType === 'order' ? OrdersApi : ShipmentsApi;
  switch (entry.operation) {
    case 'status':
      // For orders, the server treats PATCH /orders/:id with { status }
      // identically to the dedicated status route. For shipments, the
      // dedicated /:id/status route enforces a state-machine check
      // (QA bug #63), so we MUST use it instead of generic .update.
      if (entry.entityType === 'shipment') {
        return await api.updateStatus(entry.entityId, (entry.payload || {}).status);
      }
      return await api.update(entry.entityId, entry.payload || {});
    case 'patch':
      return await api.update(entry.entityId, entry.payload || {});
    case 'create':
      return await api.create(entry.payload || {});
    case 'delete':
      return await api.remove(entry.entityId);
    default:
      throw new Error(`Unknown operation '${(entry as any).operation}'`);
  }
}

// ── Internal ────────────────────────────────────────────────────────

function pretty(t: string): string {
  if (t === 'order') return 'Order';
  if (t === 'shipment') return 'Shipment';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ── Test-only internal handles ──────────────────────────────────────

export const _internal = {
  fetchCurrent,
  isNotFound,
  pretty,
};
