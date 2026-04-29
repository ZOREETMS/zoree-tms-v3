/**
 * Mobile orders service — orchestration layer for actions a user can
 * take on a single order from the mobile UI.
 *
 * Pure service layer: calls OrdersApi, returns plain data, no React
 * state, no toasts, no navigation.
 *
 * Web parity reference: frontend/src/services/ordersService.js
 *   - copyOrder()         → port below
 *   - copyOrderLines()    → port below
 *   - createNewOrder()    → port below as saveOrder()
 *
 * Field shapes intentionally match the web copy so a record created /
 * copied on mobile is indistinguishable from one created on web. Do
 * not introduce mobile-only field aliases here — extend the shared
 * types instead.
 *
 * Why we route through OrdersApi.create / OrdersApi.update (not the
 * raw DbApi.upsert):
 *   - The /api/orders POST + PATCH endpoints normalise the payload
 *     through api/services/orderMutations.js:apiOrderToDbPatch, which
 *     accepts BOTH camelCase (destination, originZip, shipMode, …)
 *     AND snake_case (dest, origin_zip, ship_mode, …) field names.
 *   - The mobile DataContext loads orders via GET /api/orders →
 *     dbToOrderApi(), which emits camelCase. Building the upsert
 *     payload off camelCase source fields and then sending it to a
 *     raw snake_case-only upsert endpoint silently nulled the
 *     mismatched fields and tripped NOT-NULL constraints (the 400
 *     "Upsert failed" the QA suite caught on Copy Order).
 *   - PATCH /api/orders/:id additionally records change-history
 *     diffs server-side (REQ-02), which the raw /api/db/orders path
 *     skips. So updates routed through OrdersApi.update get audited.
 */

import { OrdersApi } from '../shared/api';

/**
 * Generate the next order id used for copies and ad-hoc creates.
 * Format `ORD-YYYY-NNNNNN` — six trailing digits taken from the
 * current epoch ms so two rapid copies still get distinct ids.
 */
export function nextOrderId(): string {
  const ts = Date.now().toString().slice(-6);
  return `ORD-${new Date().getFullYear()}-${ts}`;
}

/**
 * Build the payload for a copy of `source`. Pulled out of `copyOrder`
 * so tests can assert the shape without mocking network calls, and so
 * future call sites (e.g. a "duplicate order" bulk action) can reuse
 * the field-mapping logic.
 *
 * Rules:
 *  - status always resets to 'Unplanned'
 *  - shipment_id is forcibly cleared
 *  - alias fallbacks read EITHER casing — the source row may come from
 *    GET /api/orders (camelCase via dbToOrderApi) or from a raw DB
 *    fetch (snake_case). Either way we end up with a camelCase
 *    payload; the server normalises it via apiOrderToDbPatch.
 *  - missing optional fields become null/0/false rather than
 *    undefined, so the new row writes deterministically.
 */
export function buildOrderCopyPayload(source: any, newId: string) {
  const s = source || {};
  return {
    id: newId,
    customer: s.customer ?? null,
    origin: s.origin ?? null,
    // dbToOrderApi exposes the column as `destination`; raw DB rows
    // (and old web code) use `dest`. Accept both — falling back to
    // null only if neither is present.
    destination: s.destination ?? s.dest ?? null,
    originZip: s.originZip ?? s.origin_zip ?? null,
    destZip: s.destZip ?? s.dest_zip ?? null,
    shipFromName: s.shipFromName ?? s.ship_from_name ?? null,
    shipToName: s.shipToName ?? s.ship_to_name ?? null,
    weight: s.weight ?? 0,
    pieces: s.pieces ?? 0,
    commodity: s.commodity ?? null,
    readyDate: s.readyDate ?? s.ready ?? null,
    dueDate: s.dueDate ?? s.due ?? null,
    status: 'Unplanned',
    shipmentId: null,
    shipMode: s.shipMode ?? s.ship_mode ?? null,
    serviceLevel: s.serviceLevel ?? s.service_level ?? null,
    incoterms: s.incoterms ?? null,
    preferredCarrier: s.preferredCarrier ?? s.preferred_carrier ?? null,
    excludedCarrier: s.excludedCarrier ?? s.excluded_carrier ?? null,
    noConsolidate: s.noConsolidate ?? s.no_consolidate ?? false,
    hazmat: s.hazmat ?? false,
    noContractRate: s.noContractRate ?? s.no_contract_rate ?? false,
    dedicatedEquip: s.dedicatedEquip ?? s.dedicated_equip ?? false,
    notes: s.notes ?? null,
    poNum: s.poNum ?? s.po_number ?? s.po_num ?? null,
    refNum: s.refNum ?? s.ref_num ?? null,
  };
}

/**
 * Build the payload for a save (create or edit) coming from
 * OrderFormScreen. The form holds form-friendly strings (e.g. weight
 * as a typed text value); coerce to API-shape primitives here so the
 * UI doesn't have to know about the wire contract.
 */
export function buildOrderSavePayload(form: any) {
  const f = form || {};
  return {
    id: f.id || undefined,
    customer: trimOrNull(f.customer),
    origin: trimOrNull(f.origin),
    destination: trimOrNull(f.destination ?? f.dest),
    originZip: trimOrNull(f.originZip),
    destZip: trimOrNull(f.destZip),
    shipFromName: trimOrNull(f.shipFromName),
    shipToName: trimOrNull(f.shipToName),
    weight: toIntOrZero(f.weight),
    pieces: toIntOrZero(f.pieces),
    commodity: trimOrNull(f.commodity) || 'General',
    shipMode: trimOrNull(f.shipMode),
    serviceLevel: trimOrNull(f.serviceLevel),
    incoterms: trimOrNull(f.incoterms),
    refNum: trimOrNull(f.refNum),
    poNum: trimOrNull(f.poNum),
    readyDate: trimOrNull(f.readyDate),
    dueDate: trimOrNull(f.dueDate),
    status: f.status || 'Unplanned',
    preferredCarrier: trimOrNull(f.preferredCarrier),
    excludedCarrier: trimOrNull(f.excludedCarrier),
    noConsolidate: !!f.noConsolidate,
    hazmat: !!f.hazmat,
    noContractRate: !!f.noContractRate,
    dedicatedEquip: !!f.dedicatedEquip,
    notes: trimOrNull(f.notes),
  };
}

function trimOrNull(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function toIntOrZero(v: any): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseInt(String(v).replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Validation that mirrors api/services/orders.js:validateOrder so we
 * fail fast on the client without round-tripping. Returns an array of
 * human-readable messages — empty means valid.
 */
export function validateOrderPayload(payload: any): string[] {
  const errors: string[] = [];
  if (!payload?.customer) errors.push('Customer is required');
  if (!payload?.origin) errors.push('Origin is required');
  if (!payload?.destination) errors.push('Destination is required');
  if (!payload?.weight || payload.weight <= 0) errors.push('Weight must be greater than 0');
  return errors;
}

/**
 * Duplicate the source order's order_lines onto the target order.
 *
 * The backend POST /orders/:id/lines regenerates line ids from the
 * target id and recalculates rolled-up weight/pieces/line_count, so
 * we strip identity fields before posting. No-ops cleanly when the
 * source has no lines.
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
 * @returns The new order row that was created (caller can use it to
 *          navigate or merge into local state without re-fetching).
 * @throws  If `source` lacks an id — callers should always have a
 *          fully-loaded order before invoking copy.
 */
export async function copyOrder(source: any): Promise<any> {
  if (!source || !source.id) {
    throw new Error('copyOrder: source order missing id');
  }
  const newId = nextOrderId();
  const payload = buildOrderCopyPayload(source, newId);
  // Routes through POST /api/orders → apiOrderToDbPatch, which
  // tolerates both camelCase and snake_case keys. Returns the created
  // DB row (or whatever the server's dbUpsert response shape is).
  const created = await OrdersApi.create(payload);
  await copyOrderLines(source.id, newId);
  // Prefer the server's row when present (carries created_at, etc.);
  // fall back to the local payload so callers can navigate
  // immediately without a re-fetch.
  return created || payload;
}

/**
 * Save an order from the form screen. Routes to OrdersApi.create for
 * new rows and OrdersApi.update for edits. Validation runs first so
 * we don't bother the server with obviously-bad payloads.
 *
 * @param form     Form state (UI-shape, mostly camelCase strings)
 * @param orderId  Pass for edits; omit for create
 * @returns        The saved order row (server response when present,
 *                 otherwise the locally-built payload).
 * @throws         Validation Error with `.fields` listing the missing
 *                 / invalid fields, OR a network error from the API.
 */
export async function saveOrder(form: any, orderId?: string | null): Promise<any> {
  const isEdit = !!orderId;
  const payload = buildOrderSavePayload(form);
  const errors = validateOrderPayload(payload);
  if (errors.length) {
    const err = new Error(errors.join(', ')) as Error & { fields?: string[] };
    err.fields = errors;
    throw err;
  }
  if (isEdit) {
    const updated = await OrdersApi.update(orderId as string, payload);
    return updated || { ...payload, id: orderId };
  }
  const created = await OrdersApi.create(payload);
  return created || payload;
}
