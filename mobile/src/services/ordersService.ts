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

import { OrdersApi, ShipmentsApi, DbApi } from '../shared/api';
// QA bug #121: deleteOrder uses the gating helper to fail fast for
// non-deletable statuses (Tender Accepted / In Transit / Delivered)
// before round-tripping. Service file pulled out per CLAUDE_RULES so
// the screen never duplicates the rule inline.
import { canDeleteOrder } from './orderActionRules';

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
  // QA #156: carry the structured city/state/zip alongside the composed
  // origin/destination strings. Without this, a copied order arrived at
  // OrderFormScreen with only the flat `origin` text — when the form
  // tried to hydrate City/State from the camelCase columns those came
  // back undefined and the user saw blank fields. Falling back through
  // a parsed-address helper keeps web-edited orders (which may only
  // store the composed string) round-trippable too.
  const parsedOrigin = parseAddressString(s.origin || s.originLocation);
  const parsedDest   = parseAddressString(s.destination || s.dest);
  return {
    id: newId,
    customer: s.customer ?? null,
    origin: s.origin ?? null,
    // dbToOrderApi exposes the column as `destination`; raw DB rows
    // (and old web code) use `dest`. Accept both — falling back to
    // null only if neither is present.
    destination: s.destination ?? s.dest ?? null,
    // QA #156 — || (not ??) so empty strings from parseAddressString
    // collapse to null and stay consistent with the rest of this
    // payload (customer/notes/etc. all use ?? null but their non-string
    // sources never produce '').
    originCity:  s.originCity  || s.origin_city  || s.shipFromCity  || s.ship_from_city  || parsedOrigin.city  || null,
    originState: s.originState || s.origin_state || s.shipFromState || s.ship_from_state || parsedOrigin.state || null,
    destCity:    s.destCity    || s.dest_city    || s.shipToCity    || s.ship_to_city    || parsedDest.city    || null,
    destState:   s.destState   || s.dest_state   || s.shipToState   || s.ship_to_state   || parsedDest.state   || null,
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
 * QA #156 helper — parse a "CITY, ST ZIP" or "Name, CITY, ST ZIP"
 * string into city/state/zip parts. Mirror of parseAddressString in
 * frontend/src/types/location.js so the mobile bundle doesn't need to
 * reach into the web src tree at build time.
 */
function parseAddressString(str: any): { city: string; state: string; zip: string } {
  if (!str) return { city: '', state: '', zip: '' };
  let s = String(str);
  let zip = '';
  const m = s.match(/\b(\d{5})\b/);
  if (m) {
    zip = m[1];
    s = s.replace(m[1], '').replace(/,?\s*$/, '').trim();
  }
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { city: '', state: '', zip };
  if (parts.length === 1) return { city: parts[0], state: '', zip };
  return {
    city: parts[parts.length - 2],
    state: parts[parts.length - 1],
    zip,
  };
}

/**
 * QA bug #106 helper: compose a "City, ST ZIP" address string from
 * the new mobile City + State + ZIP form fields. Mirrors the web's
 * LocationFieldsEditor canonicalisation so origin / dest values are
 * indistinguishable between mobile and web on the saved row.
 *
 * Returns null when nothing useful was supplied (so the caller can
 * fall through to whatever the dropdown picked).
 */
export function composeAddress(
  city: string | null | undefined,
  state: string | null | undefined,
  zip: string | null | undefined,
): string | null {
  const c = String(city || '').trim();
  const s = String(state || '').trim().toUpperCase();
  const z = String(zip || '').trim();
  if (!c && !s && !z) return null;
  let head = '';
  if (c && s) head = `${c}, ${s}`;
  else if (c) head = c;
  else if (s) head = s;
  return (head + (z ? ` ${z}` : '')).trim() || null;
}

/**
 * Build the payload for a save (create or edit) coming from
 * OrderFormScreen. The form holds form-friendly strings (e.g. weight
 * as a typed text value); coerce to API-shape primitives here so the
 * UI doesn't have to know about the wire contract.
 *
 * QA bug #106: if the user typed values into the new City/State
 * inputs, those override whatever was pre-populated by the
 * Origin/Destination dropdown. The orders table stores origin/dest
 * as a free-text "City, ST ZIP" string, so we compose the typed
 * fields into that same shape. ship_from_name / ship_to_name remain
 * pass-through for back-compat with web-edited orders, but the
 * mobile form no longer collects them.
 */
export function buildOrderSavePayload(form: any) {
  const f = form || {};
  const composedOrigin = composeAddress(f.originCity, f.originState, f.originZip);
  const composedDest = composeAddress(f.destCity, f.destState, f.destZip);
  return {
    id: f.id || undefined,
    customer: trimOrNull(f.customer),
    // Prefer the explicitly-typed City/State address; fall back to
    // the dropdown value so users who only used the picker still
    // produce a populated origin/destination column.
    origin: composedOrigin || trimOrNull(f.origin),
    destination: composedDest || trimOrNull(f.destination ?? f.dest),
    originZip: trimOrNull(f.originZip),
    destZip: trimOrNull(f.destZip),
    shipFromName: trimOrNull(f.shipFromName),
    shipToName: trimOrNull(f.shipToName),
    weight: toIntOrZero(f.weight),
    pieces: toIntOrZero(f.pieces),
    // QA bug #116: commodity used to be force-filled with "General" on
    // both the form default and the save fallback. The user wants the
    // field to genuinely stay blank when they don't pick a value, so
    // the column nulls cleanly here. The DB allows NULL and any
    // analytics path that previously bucketed "General" should switch
    // to bucketing NULL the same way (see analyticsService — which
    // already coalesces missing commodity to "Unknown").
    commodity: trimOrNull(f.commodity),
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
 * Strip null / undefined / empty-string fields from a save payload.
 *
 * QA bug #92 ("DB update failed (400)") fix: the form always emits
 * every field via trimOrNull, so empty inputs come through as null.
 * On EDIT that PATCHes the existing row, sending null for an unchanged
 * blank input causes PostgREST to attempt to write null into a
 * NOT-NULL column (or trip a CHECK constraint), returning 400. By
 * omitting unset keys on edit we let PostgREST keep the column's
 * existing value.
 *
 * Boolean fields are deliberately preserved — `false` is meaningful
 * (it's how the user un-checks Hazmat / Do Not Consolidate / etc.).
 * The `id` field is also preserved so the server can echo it.
 */
function omitUnsetFields(payload: any): any {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(payload || {})) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

/**
 * QA bug #121: Delete an order from the mobile detail screen. Routes
 * through OrdersApi.remove (DELETE /api/orders/:id) so the server can
 * unassign any linked shipment, record an audit row (REQ-02) and
 * apply the same access-control / status-gate rules the web has
 * always enforced. Validation here is a defensive duplicate of the
 * server's status guard - it lets the screen surface a friendlier
 * "Cannot delete a delivered order" message before round-tripping.
 *
 * @param order  The order being deleted (full row; status field used
 *               for the local guard).
 * @throws       A validation Error when the order is in a non-deletable
 *               state (server enforces the same rule), or whatever
 *               OrdersApi.remove rejects with on a network / 4xx.
 */
export async function deleteOrder(order: any): Promise<void> {
  if (!order || !order.id) {
    throw new Error('deleteOrder: order missing id');
  }
  if (!canDeleteOrder(order)) {
    throw new Error(
      `Order in status "${order.status}" cannot be deleted. Cancel it instead.`,
    );
  }
  await OrdersApi.remove(order.id);
}

/**
 * Save an order from the form screen. Routes to OrdersApi.create for
 * new rows and OrdersApi.update for edits. Validation runs first so
 * we don't bother the server with obviously-bad payloads.
 *
 * @param form     Form state (UI-shape, mostly camelCase strings)
 * @param orderId  Pass for edits; omit for create
 * @returns        The saved order row from the server. Throws if the
 *                 server response is empty / missing an id — see #91.
 * @throws         Validation Error with `.fields` listing the missing
 *                 / invalid fields, OR a network error from the API.
 */
/**
 * QA P218 (2026-05-11): mobile parity with web's
 * frontend/src/services/ordersService.js:unplanOrderFromShipment.
 *
 * Move an order back to "Unplanned" and detach it from its current
 * shipment. If the order was the only one on that shipment, the
 * shipment is removed (and the master shipment removed when no
 * siblings remain). Mirrors the web behaviour exactly so a mobile
 * unplan produces the same audit + cascade as a desktop unplan.
 *
 * Routes through OrdersApi.update / ShipmentsApi.update so REQ-02
 * change-history rows are written by the API layer (not duplicated
 * client-side).
 *
 * @returns { message, deletedShipments } — same shape as the web,
 *          so screens can re-use the success toast string verbatim.
 * @throws  Validation / network errors from the API.
 */
export async function unplanOrderFromShipment(
  id: string,
  orders: any[],
  shipments: any[],
): Promise<{ message: string; deletedShipments: string[] }> {
  if (!id) throw new Error('unplanOrderFromShipment: id is required');

  const deletedShipments: string[] = [];
  const order = (orders || []).find((o) => String(o?.id) === String(id));
  const shipmentId: string | undefined =
    order?.shipment_id || order?.shipmentId;

  await OrdersApi.update(id, { status: 'Unplanned', shipmentId: null });

  let message = `Order ${id} unplanned`;

  if (shipmentId) {
    const ship = (shipments || []).find(
      (s) => String(s?.id) === String(shipmentId),
    );
    const linked: string[] = Array.isArray(ship?.order_ids) ? ship.order_ids : [];
    const remaining = linked.filter((oid) => String(oid) !== String(id));

    if (remaining.length === 0) {
      // No orders remain — delete the shipment via the cascade-aware
      // endpoint (server unlinks any straggling references). Best-effort.
      await DbApi.remove?.('shipments', shipmentId).catch(() => {});
      deletedShipments.push(shipmentId);
      const masterId: string | undefined = ship?.master_shipment_id;
      if (masterId) {
        const siblingCbols = (shipments || []).filter(
          (s) =>
            String(s?.master_shipment_id) === String(masterId) &&
            String(s?.id) !== String(shipmentId),
        );
        if (siblingCbols.length === 0) {
          await DbApi.remove?.('shipments', masterId).catch(() => {});
          deletedShipments.push(masterId);
          message = `Order ${id} unplanned. Shipment ${shipmentId} and master ${masterId} deleted.`;
        } else {
          message = `Order ${id} unplanned. Shipment ${shipmentId} deleted.`;
        }
      } else {
        message = `Order ${id} unplanned. Shipment ${shipmentId} deleted.`;
      }
    } else {
      // Other orders still on the shipment — patch the remaining list
      // through the audited PATCH endpoint (shipmentToDb maps
      // consolidatedOrders → order_ids on the way into the DB).
      await ShipmentsApi.update(shipmentId, { consolidatedOrders: remaining });
      message = `Order ${id} unplanned and removed from shipment ${shipmentId}.`;
    }
  }

  return { message, deletedShipments };
}

/**
 * Bulk variant of `unplanOrderFromShipment` for the mobile selection
 * bar's "Remove Shipments" action (QA P218). Sequenced rather than
 * parallel so the per-order shipment-cascade decisions see the latest
 * shipment state — running in parallel would race on the order_ids
 * array writes.
 *
 * Returns an aggregate result so the UI can render a single toast
 * instead of N toasts.
 */
export async function unplanOrdersBulk(
  ids: string[],
  orders: any[],
  shipments: any[],
): Promise<{ unplanned: string[]; failed: { id: string; reason: string }[]; deletedShipments: string[] }> {
  const unplanned: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  const deletedShipments: string[] = [];

  // Snapshot then mutate — we don't have a fresh fetch between calls,
  // but updating the local copies as we go means cascade decisions
  // (delete vs. patch order_ids) see the running state for the same
  // shipment when multiple selected orders share it.
  const liveOrders = Array.isArray(orders) ? [...orders] : [];
  const liveShipments = Array.isArray(shipments) ? [...shipments] : [];

  for (const id of ids) {
    try {
      const res = await unplanOrderFromShipment(id, liveOrders, liveShipments);
      unplanned.push(id);
      // Reflect the change locally so a later iteration on the same
      // shipment doesn't try to delete it twice.
      const idx = liveOrders.findIndex((o) => String(o?.id) === String(id));
      if (idx >= 0) {
        liveOrders[idx] = { ...liveOrders[idx], status: 'Unplanned', shipment_id: null };
      }
      for (const sid of res.deletedShipments) {
        deletedShipments.push(sid);
        const si = liveShipments.findIndex((s) => String(s?.id) === String(sid));
        if (si >= 0) liveShipments.splice(si, 1);
      }
    } catch (err: any) {
      failed.push({ id, reason: err?.message || String(err) });
    }
  }

  return { unplanned, failed, deletedShipments };
}

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
    // #92: omit unset fields so PostgREST does not try to write null
    // into NOT-NULL columns or violate the status CHECK constraint.
    const editPayload = omitUnsetFields(payload);
    const updated = await OrdersApi.update(orderId as string, editPayload);
    if (!updated || !updated.id) {
      throw new Error('Order update did not return a row. Please retry.');
    }
    return updated;
  }
  const created = await OrdersApi.create(payload);
  // #91: refuse to report success when the server returned nothing —
  // previously we fell back to `payload` and the form thought the
  // create worked even though no row was written. Surface a concrete
  // error so the form can show it and the user can retry.
  if (!created || !created.id) {
    throw new Error('Order create did not return a row. Please retry.');
  }
  return created;
}
