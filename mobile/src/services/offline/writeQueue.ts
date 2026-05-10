// ═══════════════════════════════════════════════════════════════════
// writeQueue — REQ-OFFLINE Phase 5 (mobile, 2026-05-10).
//
// Persisted queue of pending writes (orders + shipments only in the
// MVP). When the device is offline the screens enqueue via
// {@link enqueue}; the {@link syncEngine} drains the queue on
// reconnect, applying conflict resolution before each replay.
//
// Persistence: SQLite `write_queue` table (schema in lib/localDb.ts).
// We do NOT keep an in-memory mirror — every read goes back through
// SQLite so a hard kill of the app between enqueue and replay is
// transparently recovered. Process restart safety is the whole point
// of this layer.
//
// Status lifecycle
// ────────────────
//   pending    → fresh enqueue.
//   in_flight  → syncEngine is currently sending it. Cleared back to
//                 pending if the process dies; we treat anything in
//                 'in_flight' at boot as pending.
//   conflict   → server-wins conflict resolver found the server row
//                moved on since base_version. Surfaced in the UI;
//                user must acknowledge or retry.
//   failed     → terminal error (4xx other than 409, exceeded retry
//                budget). Surfaced in the UI.
//
// The queue is bounded: {@link MAX_PENDING} caps how many writes can
// accumulate before {@link enqueue} starts rejecting. This is a
// safety net against runaway queues from a misbehaving screen.
// ═══════════════════════════════════════════════════════════════════

import { getDb } from '../../lib/localDb';

// ── Constants ───────────────────────────────────────────────────────

/** Cap on the number of pending writes the queue will accept. */
export const MAX_PENDING = 500;

/** Max replay attempts before a queued write moves to status='failed'. */
export const MAX_ATTEMPTS = 5;

// ── Types ───────────────────────────────────────────────────────────

export type QueueEntityType = 'order' | 'shipment';

/**
 * Operations the offline-aware screens are allowed to queue. The
 * conflictResolver maps each to a service-layer call.
 *
 *   'status'  — order/shipment status flip ({ status: 'Tendered' })
 *   'patch'   — generic PATCH /api/orders/:id or /api/shipments/:id
 *               with whatever payload the screen submitted.
 *   'create'  — POST a new entity. NOT used for orders in the MVP
 *               (planning happens online-only) but reserved for
 *               future use; the resolver knows to treat the
 *               local entity_id as a tombstone the server's
 *               returned id replaces.
 *   'delete'  — DELETE /api/orders/:id or /api/shipments/:id.
 */
export type QueueOperation = 'status' | 'patch' | 'create' | 'delete';

export type QueueStatus = 'pending' | 'in_flight' | 'conflict' | 'failed';

export interface QueueEntry {
  id: number;
  entityType: QueueEntityType;
  entityId: string;
  operation: QueueOperation;
  payload: any;
  /** ISO string captured at enqueue time. Used by conflictResolver. */
  baseVersion: string | null;
  enqueuedAt: string;
  lastAttemptAt: string | null;
  attempts: number;
  status: QueueStatus;
  errorMessage: string | null;
}

export interface EnqueueInput {
  entityType: QueueEntityType;
  entityId: string;
  operation: QueueOperation;
  payload: any;
  /** Pass the entity's `updated_at` at the time the user submitted. */
  baseVersion?: string | null;
}

export class QueueFullError extends Error {
  constructor() { super(`Offline queue is full (max ${MAX_PENDING} pending writes).`); }
}

// ── Internal helpers ────────────────────────────────────────────────

function rowToEntry(row: any): QueueEntry {
  return {
    id:            row.id,
    entityType:    row.entity_type,
    entityId:      row.entity_id,
    operation:     row.operation,
    payload:       safeJsonParse(row.payload),
    baseVersion:   row.base_version ?? null,
    enqueuedAt:    row.enqueued_at,
    lastAttemptAt: row.last_attempt_at ?? null,
    attempts:      row.attempts ?? 0,
    status:        row.status,
    errorMessage:  row.error_message ?? null,
  };
}

function safeJsonParse(s: any): any {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return null; }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Append a write to the queue. Returns the new entry id.
 * Throws QueueFullError if the pending backlog exceeds MAX_PENDING —
 * the caller (UI) should treat that as "queue saturated; refuse the
 * action and tell the user to come back online".
 */
export async function enqueue(input: EnqueueInput): Promise<number> {
  const db = await getDb();
  const pending = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM write_queue WHERE status IN ('pending','in_flight');`,
  );
  if ((pending?.c ?? 0) >= MAX_PENDING) throw new QueueFullError();

  const result = await db.runAsync(
    `INSERT INTO write_queue
       (entity_type, entity_id, operation, payload, base_version, enqueued_at, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending');`,
    input.entityType,
    input.entityId,
    input.operation,
    JSON.stringify(input.payload ?? null),
    input.baseVersion ?? null,
    new Date().toISOString(),
  );
  return Number(result.lastInsertRowId);
}

/**
 * Read the next pending entry (FIFO). Returns null if the queue is
 * empty. Marks the entry 'in_flight' so a concurrent drainer can't
 * grab the same row.
 */
export async function takeNextPending(): Promise<QueueEntry | null> {
  const db = await getDb();
  // Acquire under a transaction so two concurrent calls can't both
  // grab the same row.
  let entry: QueueEntry | null = null;
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<any>(
      `SELECT * FROM write_queue
       WHERE status = 'pending'
       ORDER BY enqueued_at ASC, id ASC
       LIMIT 1;`,
    );
    if (!row) return;
    await db.runAsync(
      `UPDATE write_queue
       SET status = 'in_flight',
           last_attempt_at = ?,
           attempts = attempts + 1
       WHERE id = ?;`,
      new Date().toISOString(),
      row.id,
    );
    entry = rowToEntry({ ...row, status: 'in_flight', attempts: (row.attempts ?? 0) + 1 });
  });
  return entry;
}

/**
 * Move an in-flight entry back to pending — used when a replay fails
 * with a retryable error (network blip, 5xx). Respects MAX_ATTEMPTS:
 * after that, the entry is marked 'failed' instead.
 */
export async function markRetry(id: number, errorMessage: string): Promise<void> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ attempts: number }>(
    `SELECT attempts FROM write_queue WHERE id = ?;`,
    id,
  );
  if (!row) return;
  if (row.attempts >= MAX_ATTEMPTS) {
    await db.runAsync(
      `UPDATE write_queue SET status = 'failed', error_message = ? WHERE id = ?;`,
      errorMessage,
      id,
    );
    return;
  }
  await db.runAsync(
    `UPDATE write_queue SET status = 'pending', error_message = ? WHERE id = ?;`,
    errorMessage,
    id,
  );
}

/** Mark an entry as 'conflict' — the server row moved on. UI surfaces it. */
export async function markConflict(id: number, errorMessage: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE write_queue SET status = 'conflict', error_message = ? WHERE id = ?;`,
    errorMessage,
    id,
  );
}

/** Mark an entry as 'failed' (terminal error, no retry). */
export async function markFailed(id: number, errorMessage: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE write_queue SET status = 'failed', error_message = ? WHERE id = ?;`,
    errorMessage,
    id,
  );
}

/** Drop the entry — used after successful replay. */
export async function remove(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM write_queue WHERE id = ?;`, id);
}

/**
 * Boot housekeeping: rows left in 'in_flight' from a previous app
 * lifecycle (crash, force-kill mid-replay) are moved back to
 * 'pending' so the next drain picks them up. Idempotent.
 */
export async function reclaimOrphans(): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    `UPDATE write_queue SET status = 'pending' WHERE status = 'in_flight';`,
  );
  return Number(result.changes ?? 0);
}

/**
 * UI-facing counts. `pending` is what the SyncStatusIndicator badges.
 * `conflict` / `failed` surface in a future "Resolve conflicts" screen.
 */
export interface QueueCounts {
  pending: number;
  inFlight: number;
  conflict: number;
  failed: number;
  total: number;
}

export async function counts(): Promise<QueueCounts> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ status: string; c: number }>(
    `SELECT status, COUNT(*) AS c FROM write_queue GROUP BY status;`,
  );
  const out: QueueCounts = { pending: 0, inFlight: 0, conflict: 0, failed: 0, total: 0 };
  for (const r of rows) {
    if (r.status === 'pending')   out.pending  = r.c;
    if (r.status === 'in_flight') out.inFlight = r.c;
    if (r.status === 'conflict')  out.conflict = r.c;
    if (r.status === 'failed')    out.failed   = r.c;
    out.total += r.c;
  }
  return out;
}

/**
 * Return every entry for a given entity. Used by screens that want to
 * show "this order has 1 pending change" inline.
 */
export async function listForEntity(
  entityType: QueueEntityType,
  entityId: string,
): Promise<QueueEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM write_queue
     WHERE entity_type = ? AND entity_id = ?
     ORDER BY enqueued_at ASC, id ASC;`,
    entityType,
    entityId,
  );
  return rows.map(rowToEntry);
}

/**
 * Return every entry currently in 'conflict' or 'failed'. The future
 * "Resolve conflicts" screen consumes this.
 */
export async function listUnresolved(): Promise<QueueEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM write_queue
     WHERE status IN ('conflict','failed')
     ORDER BY enqueued_at ASC, id ASC;`,
  );
  return rows.map(rowToEntry);
}

/**
 * Delete every queued write. Use sparingly — only from "Reset offline
 * queue" admin actions or from logout (a queue belongs to a session).
 */
export async function clearAll(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`DELETE FROM write_queue;`);
}

// ── Test-only internal handles ──────────────────────────────────────

export const _internal = {
  rowToEntry,
};
