// ═══════════════════════════════════════════════════════════════════
// offlineOrderActions — REQ-OFFLINE Phase 5 (mobile, 2026-05-10).
//
// Thin façade over OrdersApi that routes through the offline write
// queue when the device isn't online. Screens call this instead of
// OrdersApi directly so they never have to inspect connectivity
// themselves (CLAUDE_RULES §3 — UI doesn't embed business logic).
//
// Online path:  call OrdersApi, return server response.
// Offline path: enqueue, return a local "queued" envelope so the
//               caller can update its own UI optimistically.
//
// What lives here vs. what doesn't
// ────────────────────────────────
// IN scope (offline-safe in the MVP):
//   • PATCH /api/orders/:id  — status flips + field edits
//   • DELETE /api/orders/:id — destructive but well-bounded
//
// OUT of scope (must require connectivity in the MVP):
//   • POST /api/orders        — creation depends on server-generated
//                                 ids and downstream OMS pushes.
//   • Planning / tendering    — multi-step server orchestration.
//   • Order lines edits       — separate endpoint, separate queue
//                                 design needed.
// ═══════════════════════════════════════════════════════════════════

// @ts-expect-error — shared/api.js is JS, no .d.ts.
import { OrdersApi } from '../../lib/api';
import { isOnline } from '../../lib/connectivity';
import { enqueue, type QueueOperation } from './writeQueue';

// ── Public types ────────────────────────────────────────────────────

/**
 * What a queued action returns to the caller in lieu of the server's
 * response. Lets screens update their own state optimistically while
 * surfacing that the change isn't yet authoritative.
 */
export interface QueuedActionResult {
  status: 'queued';
  queueId: number;
  /** ISO timestamp captured at enqueue. */
  enqueuedAt: string;
}

export interface AppliedActionResult<T = any> {
  status: 'applied';
  serverResponse: T;
}

export type ActionResult<T = any> = QueuedActionResult | AppliedActionResult<T>;

// ── Internal helpers ────────────────────────────────────────────────

function versionOf(row: any): string | null {
  if (!row || typeof row !== 'object') return null;
  if (typeof row.updated_at === 'string') return row.updated_at;
  if (typeof row.updatedAt  === 'string') return row.updatedAt;
  return null;
}

/**
 * Enqueue a queued write and return the standard envelope. Wrapping
 * the writeQueue.enqueue call here lets the public functions stay
 * one-liners.
 */
async function queueWrite(
  orderId: string,
  operation: QueueOperation,
  payload: any,
  baseVersion: string | null,
): Promise<QueuedActionResult> {
  const queueId = await enqueue({
    entityType: 'order',
    entityId:   orderId,
    operation,
    payload,
    baseVersion,
  });
  return { status: 'queued', queueId, enqueuedAt: new Date().toISOString() };
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Update an order's status. Mirrors OrdersApi.update(id, { status })
 * but routes through the queue when offline.
 *
 * @param order  The current order row — used to capture base_version
 *               at enqueue time. Pass the same row the screen rendered
 *               (data.orders[i] or order detail load). If omitted, the
 *               server-wins guard is weaker but the call still works.
 */
export async function updateOrderStatus(
  orderId: string,
  newStatus: string,
  order?: any,
): Promise<ActionResult> {
  if (!orderId) throw new Error('orderId is required');
  if (!newStatus) throw new Error('newStatus is required');

  if (isOnline()) {
    const serverResponse = await OrdersApi.update(orderId, { status: newStatus });
    return { status: 'applied', serverResponse };
  }
  return queueWrite(
    orderId,
    'status',
    { status: newStatus },
    versionOf(order),
  );
}

/**
 * Generic patch — any subset of editable order fields. Same online/
 * offline router as updateOrderStatus.
 */
export async function patchOrder(
  orderId: string,
  patch: Record<string, any>,
  order?: any,
): Promise<ActionResult> {
  if (!orderId) throw new Error('orderId is required');
  if (!patch || typeof patch !== 'object') throw new Error('patch must be an object');

  if (isOnline()) {
    const serverResponse = await OrdersApi.update(orderId, patch);
    return { status: 'applied', serverResponse };
  }
  return queueWrite(orderId, 'patch', patch, versionOf(order));
}

/**
 * Delete an order (cascade-aware on the server). Online: hits the
 * cascade endpoint directly. Offline: queues; replays via the same
 * endpoint when reconnected. Conflict policy: if the order has been
 * re-status'd on the server since queue time, the resolver will
 * surface a conflict ("can't delete an order in Tender Accepted").
 */
export async function deleteOrderOffline(
  orderId: string,
  order?: any,
): Promise<ActionResult> {
  if (!orderId) throw new Error('orderId is required');
  if (isOnline()) {
    const serverResponse = await OrdersApi.remove(orderId);
    return { status: 'applied', serverResponse };
  }
  return queueWrite(orderId, 'delete', null, versionOf(order));
}

// ── Test-only internal handles ──────────────────────────────────────

export const _internal = {
  versionOf,
  queueWrite,
};
