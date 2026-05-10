// ═══════════════════════════════════════════════════════════════════
// offlineShipmentActions — REQ-OFFLINE Phase 5 (mobile, 2026-05-10).
//
// Façade over ShipmentsApi for the offline-safe operations.
// Mirrors offlineOrderActions — see that file for design rationale.
//
// IN scope:
//   • PATCH /api/shipments/:id/status — the canonical status flip
//   • PATCH /api/shipments/:id        — generic field edits
//   • DELETE /api/shipments/:id       — cascade-aware delete
//
// OUT of scope (require connectivity):
//   • POST /api/shipments     — creation tied to OMS bridge.
//   • Tender flows            — multi-step, audit-critical.
// ═══════════════════════════════════════════════════════════════════

// @ts-expect-error — shared/api.js is JS, no .d.ts.
import { ShipmentsApi } from '../../lib/api';
import { isOnline } from '../../lib/connectivity';
import { enqueue, type QueueOperation } from './writeQueue';
import type { ActionResult, QueuedActionResult } from './offlineOrderActions';

function versionOf(row: any): string | null {
  if (!row || typeof row !== 'object') return null;
  if (typeof row.updated_at === 'string') return row.updated_at;
  if (typeof row.updatedAt  === 'string') return row.updatedAt;
  return null;
}

async function queueWrite(
  shipmentId: string,
  operation: QueueOperation,
  payload: any,
  baseVersion: string | null,
): Promise<QueuedActionResult> {
  const queueId = await enqueue({
    entityType: 'shipment',
    entityId:   shipmentId,
    operation,
    payload,
    baseVersion,
  });
  return { status: 'queued', queueId, enqueuedAt: new Date().toISOString() };
}

/**
 * Status update. Online: ShipmentsApi.updateStatus (the dedicated
 * `/:id/status` route that enforces the state-machine check from
 * QA bug #63). Offline: queued with operation='status'. The resolver
 * dispatches back to updateStatus on replay.
 */
export async function updateShipmentStatusOffline(
  shipmentId: string,
  newStatus: string,
  shipment?: any,
): Promise<ActionResult> {
  if (!shipmentId) throw new Error('shipmentId is required');
  if (!newStatus)  throw new Error('newStatus is required');
  if (isOnline()) {
    const serverResponse = await ShipmentsApi.updateStatus(shipmentId, newStatus);
    return { status: 'applied', serverResponse };
  }
  return queueWrite(shipmentId, 'status', { status: newStatus }, versionOf(shipment));
}

export async function patchShipment(
  shipmentId: string,
  patch: Record<string, any>,
  shipment?: any,
): Promise<ActionResult> {
  if (!shipmentId) throw new Error('shipmentId is required');
  if (!patch || typeof patch !== 'object') throw new Error('patch must be an object');
  if (isOnline()) {
    const serverResponse = await ShipmentsApi.update(shipmentId, patch);
    return { status: 'applied', serverResponse };
  }
  return queueWrite(shipmentId, 'patch', patch, versionOf(shipment));
}

export async function deleteShipmentOffline(
  shipmentId: string,
  shipment?: any,
): Promise<ActionResult> {
  if (!shipmentId) throw new Error('shipmentId is required');
  if (isOnline()) {
    const serverResponse = await ShipmentsApi.remove(shipmentId);
    return { status: 'applied', serverResponse };
  }
  return queueWrite(shipmentId, 'delete', null, versionOf(shipment));
}

export const _internal = {
  versionOf,
  queueWrite,
};
