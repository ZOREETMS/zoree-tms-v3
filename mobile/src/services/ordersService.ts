/**
 * Mobile orders service — orchestration layer for actions a user can
 * take on a single order from the mobile UI.
 *
 * Pure service layer: calls DbApi / OrdersApi, returns plain data, no
 * React state, no toasts, no navigation.
 *
 * Web parity reference: frontend/src/services/ordersService.js
 *   - copyOrder()         → port below
 *   - copyOrderLines()    → port below
 *
 * Field shapes intentionally match the web copy so a record copied on
 * mobile is indistinguishable from one copied on web. Do not introduce
 * mobile-only field aliases here — extend the shared types instead.
 */

import { DbApi, OrdersApi } from '../shared/api';

/**
 * Generate the next order id used for copies and ad-hoc creates.
 * Format `ORD-YYYY-NNNNNN` — six trailing digits taken from the current
 * epoch ms so two rapid copies still get distinct ids.
 */
export function nextOrderId(): string {
  const ts = Date.now().toString().slice(-6);
  return `ORD-${new Date().getFullYear()}-${ts}`;
}

/**
 * Build the database row for a copy of `source`. Pulled out of
 * `copyOrder` so tests can assert the shape without mocking network
 * calls, and so future call sites (e.g. a "duplicate order" bulk
 * action) can reuse the field-mapping logic.
 *
 * Rules:
 *  - status always resets to 'Unplanned'
 *  - shipment_id is forcibly cleared
 *  - alias fallbacks (camelCase → snake_case) match the web
 *  - missing optional fields become null/0/false rather than undefined,
 *    so the new row writes deterministically
 */
export function buildOrderCopyPayload(source: any, newId: string) {
  return {
    id: newId,
    customer: source.customer ?? null,
    origin: source.origin ?? null,
    dest: source.dest ?? null,
    origin_zip: source.origin_zip ?? null,
    dest_zip: source.dest_zip ?? null,
    ship_from_name: source.ship_from_name ?? source.shipFromName ?? null,
    ship_to_name: source.ship_to_name ?? source.shipToName ?? null,
    weight: source.weight ?? 0,
    pieces: source.pieces ?? 0,
    commodity: source.commodity ?? null,
    ready: source.ready ?? null,
    due: source.due ?? null,
    status: 'Unplanned',
    shipment_id: null,
    ship_mode: source.ship_mode ?? null,
    incoterms: source.incoterms ?? null,
    preferred_carrier: source.preferred_carrier ?? null,
    excluded_carrier: source.excluded_carrier ?? null,
    no_consolidate: source.no_consolidate ?? false,
    hazmat: source.hazmat ?? false,
    no_contract_rate: source.no_contract_rate ?? false,
    dedicated_equip: source.dedicated_equip ?? false,
    notes: source.notes ?? null,
    po_number: source.po_number ?? source.po_num ?? null,
  };
}

/**
 * Duplicate the source order's order_lines onto the target order.
 *
 * The backend POST /orders/:id/lines regenerates line ids from the
 * target id and recalculates rolled-up weight/pieces/line_count, so we
 * strip identity fields before posting. No-ops cleanly when the source
 * has no lines.
 */
export async function copyOrderLines(sourceId: string, targetId: string): Promise<void> {
  const sourceLines = await OrdersApi.lines(sourceId);
  if (!Array.isArray(sourceLines) || sourceLines.length === 0) return;

  const payload = sourceLines.map((l: any, i: number) => ({
    line_num: l.line_num || i + 1,
    item_id: l.item_id || null,
    description: l.description || '',
    qty_ordered: l.qty_ordered || 0,
    unit_weight: l.unit_weight || 0,
    total_weight: l.total_weight || 0,
  }));

  await OrdersApi.saveLines(targetId, payload);
}

/**
 * Create a new order copied from `source`. Status is reset to
 * 'Unplanned', shipment is cleared, and source line items are
 * duplicated onto the new order.
 *
 * @returns The new order row that was upserted (caller can use it to
 *          navigate or merge into local state without re-fetching).
 * @throws  If `source` lacks an id — callers should always have a
 *          fully-loaded order before invoking copy.
 */
export async function copyOrder(source: any): Promise<any> {
  if (!source || !source.id) {
    throw new Error('copyOrder: source order missing id');
  }
  const newId = nextOrderId();
  const copy = buildOrderCopyPayload(source, newId);
  await DbApi.upsert('orders', copy);
  await copyOrderLines(source.id, newId);
  return copy;
}
