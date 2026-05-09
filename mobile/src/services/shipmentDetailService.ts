/**
 * Mobile Shipment Detail Service
 *
 * QA bug #168 fix: the mobile ShipmentDetailScreen previously rendered
 * only ~6 of the 25 fields the web Shipment Details modal shows
 * (Carrier, Origin, Destination, Pickup, Delivery, Weight, Pieces,
 * Total Cost). Service Level, Mode, Equipment, Commodity, Rate ID,
 * Base/Linehaul, Discount, FSC, Accessorials, Transit Days, PRO
 * Number, BOL, Seal Number, Dock Door, Dock Time, Loading Start/End,
 * Line Items table, and the Shipment Timeline were all missing.
 *
 * This service is the single home for the derivations + async loaders
 * the detail screen needs. Pure data — no React state, no UI side-
 * effects (CLAUDE_RULES §1, §3, §4 — services-first; the screen is a
 * dumb renderer).
 *
 * Mirrors web behaviour established in:
 *   - frontend/src/utils/shipmentCost.js              (cost breakdown)
 *   - frontend/src/services/rateService.js#summarizeDiscount
 *   - frontend/src/services/historyService.js         (history shaping)
 *   - frontend/src/services/shipmentTimelineService.js (phase derivation)
 *   - frontend/src/pages/ShipmentsPage.jsx             (line-items load)
 *
 * Re-implementing the small math functions inline is intentional: the
 * web copies live in CommonJS-flavoured JS modules that the React
 * Native bundle can't tree-shake cleanly, and porting them as TS
 * keeps the type surface honest for the screen.
 */

import { OrdersApi, ShipmentsApi } from '../lib/api';
import { deriveShipmentEquipment } from './shipmentService';

/* ── Number helpers ─────────────────────────────────────────────── */

function toNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ── Cost breakdown (port of frontend/src/utils/shipmentCost.js) ──── */

export interface CostBreakdown {
  base: number;
  fuel: number;
  accessorials: number;
  total: number;
  baseIsDerived: boolean;
}

export function deriveShipmentCostBreakdown(shipment: any): CostBreakdown {
  const total = toNum(shipment?.total_cost ?? shipment?.totalCost);
  const fuel = toNum(shipment?.fuel_surcharge ?? shipment?.fuelSurcharge);
  const accessorials = toNum(shipment?.accessorials);
  let base = toNum(shipment?.rate);

  if (base === 0 && total > 0) {
    const derived = total - fuel - accessorials;
    base = derived > 0 ? derived : total;
  }

  return {
    base,
    fuel,
    accessorials,
    total: total || base + fuel + accessorials,
    baseIsDerived: toNum(shipment?.rate) === 0 && total > 0,
  };
}

/* ── Discount (port of frontend rateService.summarizeDiscount) ───── */

export interface DiscountSummary {
  pct: number;
  flat: number;
  amount: number;
  hasDiscount: boolean;
}

export function summarizeDiscount(rate: any, baseAmount = 0): DiscountSummary {
  if (!rate) return { pct: 0, flat: 0, amount: 0, hasDiscount: false };
  const pct = toNum(rate.discount ?? rate.discount_pct);
  const flat = toNum(rate.discount_flat ?? rate.discount_amt);
  const amount = Math.round(toNum(baseAmount) * pct / 100) + flat;
  return { pct, flat, amount, hasDiscount: pct > 0 || flat > 0 };
}

/* ── Transit days from pickup/delivery dates ─────────────────────── */

export function calculateTransitDays(
  pickupDate: string | null | undefined,
  deliveryDate: string | null | undefined,
): string {
  if (!pickupDate || !deliveryDate) return '—';
  const d1 = new Date(pickupDate);
  const d2 = new Date(deliveryDate);
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return '—';
  const days = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86_400_000));
  return `${days} day${days === 1 ? '' : 's'}`;
}

/* ── Rate row lookup (uses already-cached rates from DataContext) ── */

export function findRateForShipment(shipment: any, rates: any[]): any | null {
  const laneKey = shipment?.rate_id || shipment?.rateId;
  if (!laneKey || !Array.isArray(rates)) return null;
  return rates.find((r: any) => r?.lane === laneKey || r?.id === laneKey) || null;
}

/* ── Linked orders + commodity inference ─────────────────────────── */

export function findLinkedOrders(shipment: any, orders: any[]): any[] {
  if (!shipment || !Array.isArray(orders)) return [];
  const directIds: string[] = Array.isArray(shipment.order_ids) ? shipment.order_ids : [];
  if (directIds.length) {
    return orders.filter((o: any) => directIds.includes(o.id));
  }
  // Fall back to shipment_id linkage (older rows that didn't denormalize
  // order_ids onto the shipment).
  const shipId = shipment.id || shipment.shipment_id;
  return orders.filter((o: any) => o?.shipment_id === shipId);
}

export function inferCommodity(shipment: any, linkedOrders: any[]): string {
  const direct = shipment?.commodity || shipment?._commodity;
  if (direct) return String(direct);
  for (const o of linkedOrders || []) {
    if (o?.commodity) return String(o.commodity);
  }
  return '';
}

/* ── Async loaders ────────────────────────────────────────────────── */

export interface ShipmentLineRow {
  order_id: string;
  item_id: string;
  description: string;
  qty: number;
  unitWeight: number;
  totalWeight: number;
}

/**
 * Fetch line items for every order linked to this shipment and flatten
 * into one list. Mirrors the per-shipment lines loader in
 * frontend/src/pages/ShipmentsPage.jsx (the `useEffect` that fans
 * OrdersApi.lines across `ds.order_ids`). Returns [] on any
 * per-order failure so a single bad order doesn't blank the whole
 * table — same posture the web takes.
 */
export async function loadShipmentLines(shipment: any, orders: any[]): Promise<ShipmentLineRow[]> {
  if (!shipment) return [];
  // Prefer order_ids (denormalized on the shipment), fall back to
  // linked-order discovery via shipment_id.
  let ids: string[] = Array.isArray(shipment.order_ids) && shipment.order_ids.length
    ? shipment.order_ids.slice()
    : findLinkedOrders(shipment, orders).map((o: any) => o.id).filter(Boolean);
  if (!ids.length) return [];

  const results = await Promise.all(
    ids.map((oid) =>
      OrdersApi.lines(oid)
        .then((res: any) => {
          const arr = Array.isArray(res) ? res : res?.lines || res?.data || [];
          return Array.isArray(arr) ? arr : [];
        })
        .catch(() => [] as any[]),
    ),
  );
  // Normalize each line into a stable shape so the screen doesn't have
  // to defensively .|| every column.
  return results.flat().map((l: any) => ({
    order_id:    l.order_id ?? '',
    item_id:     l.item_id ?? '',
    description: l.description ?? '',
    qty:         toNum(l.qty_ordered ?? l.qty),
    unitWeight:  toNum(l.unit_weight ?? l.unit_value),
    totalWeight: toNum(l.total_weight ?? l.total_value),
  }));
}

/* ── Shipment history → timeline phases ───────────────────────────── */

export interface ShipmentHistoryRow {
  id?: string;
  ts: string;       // formatted local time
  tsRaw: string;    // raw ISO
  user: string;
  action: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
  metadata?: any;
}

/**
 * Lightly shape raw change_history rows from
 * GET /api/shipments/:id/history into the structure the timeline derives
 * phases from. We don't need the full bucketing the web's historyService
 * does (mobile doesn't render a multi-event drawer), so this is the
 * minimum the timeline-phase derivation needs.
 */
function shapeShipmentHistoryRows(rows: any[]): ShipmentHistoryRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r: any) => ({
    id:       r.id,
    ts:       r.created_at ? new Date(r.created_at).toLocaleString() : '',
    tsRaw:    r.created_at || '',
    user:     r.username || r.user || '',
    action:   r.action || '',
    field:    r.field || undefined,
    oldValue: r.old_value ?? undefined,
    newValue: r.new_value ?? undefined,
    metadata: r.metadata || {},
  }));
}

export async function loadShipmentHistory(shipmentId: string): Promise<ShipmentHistoryRow[]> {
  if (!shipmentId) return [];
  try {
    const res: any = await ShipmentsApi.history(shipmentId, 200);
    return shapeShipmentHistoryRows(res?.rows || []);
  } catch (e) {
    // Soft fail — history is decorative; the timeline falls back to
    // shipment-row dates if it's missing.
    console.warn('[shipmentDetailService] history load failed:', (e as any)?.message);
    return [];
  }
}

/* ── Phase derivation (port of frontend shipmentTimelineService) ── */

export type TimelinePhase =
  | 'created'
  | 'tendered'
  | 'accepted'
  | 'pickedUp'
  | 'inTransit'
  | 'delivered';

function statusToPhase(status: any): TimelinePhase | null {
  const s = String(status || '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'tendered') return 'tendered';
  if (s === 'tender accepted' || s === 'confirmed') return 'accepted';
  if (s === 'picked up') return 'pickedUp';
  if (s === 'in transit') return 'inTransit';
  if (s === 'delivered') return 'delivered';
  return null;
}

export function derivePhaseTimestamps(historyRows: ShipmentHistoryRow[]): Partial<Record<TimelinePhase, string>> {
  const phases: Partial<Record<TimelinePhase, string>> = {};
  const remember = (phase: TimelinePhase | null, tsRaw: string) => {
    if (!phase || !tsRaw) return;
    const existing = phases[phase];
    if (!existing || new Date(tsRaw) < new Date(existing)) {
      phases[phase] = tsRaw;
    }
  };
  for (const row of historyRows || []) {
    const tsRaw = row?.tsRaw || row?.ts;
    if (!tsRaw) continue;
    if (row.action === 'create') remember('created', tsRaw);
    if (row.action === 'tender') remember('tendered', tsRaw);
    if (row.action === 'status') {
      const phase = statusToPhase(row.newValue);
      if (phase) remember(phase, tsRaw);
    }
  }
  return phases;
}

export function formatTimelineTs(tsRaw: string | null | undefined): string {
  if (!tsRaw) return '';
  const d = new Date(tsRaw);
  if (isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

/* ── Top-level "view model" the screen consumes ──────────────────── */

export interface ShipmentDetailViewModel {
  id: string;
  status: string;
  carrier: string;
  mode: string;
  equipment: string;
  equipmentSource: 'shipment' | 'rate' | null;
  origin: string;
  destination: string;
  shipFromName: string | null;
  shipToName: string | null;
  pickupDate: string | null;
  deliveryDate: string | null;
  transitDays: string;
  weight: number | null;
  pieces: number | null;
  commodity: string;
  rateId: string | null;
  serviceLevel: string | null;
  proNumber: string | null;
  bolNumber: string | null;
  sealNumber: string | null;
  dockDoor: string | null;
  dockTime: string | null;
  loadingStart: string | null;
  loadingEnd: string | null;
  cost: CostBreakdown;
  discount: DiscountSummary;
  fscPct: string;
  notes: string | null;
  linkedOrders: any[];
}

/**
 * Build a normalized view model from the cached shipment row (raw
 * snake_case from DbApi.shipments) + the cached rates and orders. The
 * screen consumes one object — no raw shipment access in JSX.
 */
export function buildShipmentDetailViewModel(
  shipment: any,
  rates: any[],
  orders: any[],
): ShipmentDetailViewModel {
  const linkedOrders = findLinkedOrders(shipment, orders);
  const rate = findRateForShipment(shipment, rates);
  const equipment = deriveShipmentEquipment(shipment, rate);
  const cost = deriveShipmentCostBreakdown(shipment);
  const discount = summarizeDiscount(rate, cost.base);

  return {
    id:             shipment?.id || shipment?.shipment_id || '',
    status:         shipment?.status || 'Planned',
    carrier:        shipment?.carrier || shipment?.carrier_name || '—',
    mode:           shipment?.mode || '—',
    equipment:      equipment.value || '—',
    equipmentSource: equipment.source,
    origin:         shipment?.origin || shipment?.origin_city || '—',
    destination:    shipment?.dest || shipment?.destination || shipment?.destination_city || '—',
    shipFromName:   shipment?.ship_from_name || null,
    shipToName:     shipment?.ship_to_name || null,
    pickupDate:     shipment?.pickup_date || null,
    deliveryDate:   shipment?.delivery_date || null,
    transitDays:    calculateTransitDays(shipment?.pickup_date, shipment?.delivery_date),
    weight:         shipment?.weight ?? null,
    pieces:         shipment?.pieces ?? null,
    commodity:      inferCommodity(shipment, linkedOrders),
    rateId:         shipment?.rate_id || null,
    serviceLevel:   shipment?.service_level || null,
    proNumber:      shipment?.pro_number || null,
    bolNumber:      shipment?.bol_number || null,
    sealNumber:     shipment?.seal_number || null,
    dockDoor:       shipment?.dock_door || shipment?.dock_assigned || null,
    dockTime:       shipment?.dock_time || null,
    loadingStart:   shipment?.loading_start || null,
    loadingEnd:     shipment?.loading_end || null,
    cost,
    discount,
    fscPct:         rate?.fsc ? String(rate.fsc) : '',
    notes:          shipment?.notes || null,
    linkedOrders,
  };
}
