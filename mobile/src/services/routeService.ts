/**
 * Mobile route-template service — CRUD for multi-stop route templates.
 *
 * Web parity reference:
 *   frontend/src/components/multi-stop/routeService.js   (CRUD)
 *   frontend/src/components/multi-stop/routeFactory.js   (emptyRoute, recalcLoadSeq)
 *   frontend/src/components/multi-stop/routeFormatters.js (genId)
 *
 * Pure service layer: calls DbApi, returns plain data. The web module
 * splits these helpers across several files; mobile keeps them in one
 * place since the surface is small and there's no MTBF benefit to the
 * extra files in a single-consumer feature.
 *
 * `executeRoute` (turn a template into actual shipments) is the
 * complex cascade that lives in the web ExecuteRouteModal. That's
 * out of scope for this initial port — a future iteration can pull
 * it through the same shipmentService.createShipmentsFromRoute path.
 */

import { DbApi } from '../lib/api';

const TABLE = 'route_templates';

/* ── Stop + route shapes ─────────────────────────────────────────── */

export interface RouteStop {
  sequence: number;
  city: string;
  state: string;
  location?: string;
  type: 'pickup' | 'delivery';
  stop_seq: number;
  /** Reverse-LIFO load order — only deliveries get a number. */
  load_seq: number | '';
  lat?: number | null;
  lng?: number | null;
}

export interface RouteTemplate {
  id: string;
  name: string;
  mode: string;
  carrier: string;
  max_weight: number;
  cost_override?: number | string | '';
  miles_override?: number | string | '';
  transit_days?: number | string | '';
  status: string;
  notes: string;
  stops: RouteStop[];
  total_miles: number;
}

/* ── Helpers ─────────────────────────────────────────────────────── */

export function genRouteId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  return `RT-${ts}`;
}

/**
 * Recalculate load sequence as reverse of stop sequence — deliveries
 * get a LIFO number (last loaded first), pickups get empty. Mirrors
 * web `recalcLoadSeq` exactly.
 */
export function recalcLoadSeq(stops: RouteStop[]): RouteStop[] {
  const deliveryCount = stops.filter((s) => s.type === 'delivery').length;
  let dIdx = 0;
  return stops.map((s, i) => {
    const base: RouteStop = {
      ...s,
      sequence: i + 1,
      stop_seq: i + 1,
    };
    if (s.type === 'delivery') {
      base.load_seq = deliveryCount - dIdx;
      dIdx++;
    } else {
      base.load_seq = '';
    }
    return base;
  });
}

/** Empty route template seed for the create modal. */
export function emptyRoute(): RouteTemplate {
  return {
    id: genRouteId(),
    name: '',
    mode: 'TL',
    carrier: '',
    max_weight: 44000,
    cost_override: '',
    miles_override: '',
    transit_days: '',
    status: 'Active',
    notes: '',
    stops: [
      { sequence: 1, city: '', state: '', location: '', type: 'pickup', stop_seq: 1, load_seq: '', lat: null, lng: null },
      { sequence: 2, city: '', state: '', location: '', type: 'delivery', stop_seq: 2, load_seq: 1, lat: null, lng: null },
    ],
    total_miles: 0,
  };
}

/**
 * Stop manipulation — add / remove / move. Each returns a new array
 * with `recalcLoadSeq` already applied so callers don't have to remember.
 */
export function addStop(stops: RouteStop[], type: 'pickup' | 'delivery' = 'delivery'): RouteStop[] {
  const next: RouteStop = {
    sequence: stops.length + 1,
    city: '',
    state: '',
    location: '',
    type,
    stop_seq: stops.length + 1,
    load_seq: '',
    lat: null,
    lng: null,
  };
  return recalcLoadSeq([...stops, next]);
}

export function removeStop(stops: RouteStop[], index: number): RouteStop[] {
  const filtered = stops.filter((_, i) => i !== index);
  return recalcLoadSeq(filtered);
}

export function moveStop(stops: RouteStop[], from: number, to: number): RouteStop[] {
  if (from === to || from < 0 || to < 0 || from >= stops.length || to >= stops.length) {
    return stops;
  }
  const next = stops.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return recalcLoadSeq(next);
}

export function updateStopField<K extends keyof RouteStop>(
  stops: RouteStop[],
  index: number,
  key: K,
  value: RouteStop[K],
): RouteStop[] {
  return stops.map((s, i) => (i === index ? { ...s, [key]: value } : s));
}

/* ── Distance calc (haversine) ───────────────────────────────────── */

/**
 * Haversine miles between two lat/lng pairs. Stops without coords
 * contribute 0 to the total; the web version treats the same way.
 */
function haversineMiles(a: any, b: any): number {
  if (a?.lat == null || a?.lng == null || b?.lat == null || b?.lng == null) return 0;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2
    + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function calcTotalMiles(stops: RouteStop[]): number {
  let total = 0;
  for (let i = 1; i < (stops || []).length; i++) {
    total += haversineMiles(stops[i - 1], stops[i]);
  }
  return Math.round(total);
}

/* ── Cost ────────────────────────────────────────────────────────── */

/** Simple rate-table cost — mirrors web `calcCost` (no override case). */
export function calcRouteCost(route: RouteTemplate, rates: any[]): number {
  if (route.cost_override && Number(route.cost_override) > 0) {
    return Number(route.cost_override);
  }
  const miles = calcTotalMiles(Array.isArray(route.stops) ? route.stops : []);
  if (!route.carrier || miles === 0) return 0;

  const carrierRates = (rates || []).filter(
    (r) =>
      String(r.carrier || '').toLowerCase() === String(route.carrier || '').toLowerCase()
      && String(r.mode || '').toUpperCase() === String(route.mode || 'TL').toUpperCase()
      && r.status === 'Active',
  );
  if (carrierRates.length === 0) return 0;

  const rate = carrierRates[0];
  const rpm = parseFloat(String(rate.rate || '0').replace(/[^0-9.]/g, ''));
  const fsc = parseFloat(String(rate.fsc || '0').replace(/[^0-9.]/g, '')) / 100;
  return Math.round(miles * rpm * (1 + fsc) * 100) / 100;
}

/* ── Validation ──────────────────────────────────────────────────── */

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export function validateRoute(route: RouteTemplate): ValidationResult {
  if (!route.name?.trim()) return { ok: false, error: 'Route name is required.' };
  const stops = Array.isArray(route.stops) ? route.stops : [];
  if (stops.length < 2) return { ok: false, error: 'A route needs at least 2 stops.' };
  for (let i = 0; i < stops.length; i++) {
    if (!stops[i].city?.trim()) return { ok: false, error: `Stop ${i + 1} needs a city.` };
  }
  // Must have at least one pickup and one delivery, otherwise the
  // execute flow can't tell which side is shipper / consignee.
  const hasPickup = stops.some((s) => s.type === 'pickup');
  const hasDelivery = stops.some((s) => s.type === 'delivery');
  if (!hasPickup || !hasDelivery) {
    return { ok: false, error: 'Route must have at least one pickup and one delivery stop.' };
  }
  return { ok: true };
}

/* ── Payload + mutations ─────────────────────────────────────────── */

/**
 * Build the DB row from the form state. Composes `location` from
 * city + state (legacy display columns) and coerces optional numerics.
 * Pure helper, exported for tests.
 */
export function buildRoutePayload(route: RouteTemplate): Record<string, any> {
  const stopsWithLocation = (route.stops || []).map((s) => ({
    ...s,
    location: [s.city, s.state].filter(Boolean).join(', '),
  }));
  const autoMiles = calcTotalMiles(stopsWithLocation);
  const totalMiles = route.miles_override ? Number(route.miles_override) : autoMiles;
  return {
    id: route.id || genRouteId(),
    name: route.name.trim(),
    mode: route.mode || 'TL',
    carrier: route.carrier || '',
    max_weight: Number(route.max_weight) || 0,
    transit_days: route.transit_days ? Number(route.transit_days) : null,
    miles_override: route.miles_override ? Number(route.miles_override) : null,
    cost_override: route.cost_override ? Number(route.cost_override) : null,
    total_miles: totalMiles,
    status: route.status || 'Active',
    notes: route.notes || '',
    stops: stopsWithLocation,
  };
}

export async function saveRoute(route: RouteTemplate): Promise<any> {
  const v = validateRoute(route);
  if (!v.ok) throw new Error(v.error);
  const payload = buildRoutePayload(route);
  return DbApi.upsert(TABLE, payload);
}

export async function deleteRoute(id: string): Promise<any> {
  if (!id) throw new Error('deleteRoute: id is required');
  return DbApi.remove(TABLE, id);
}

/* -- Execute (cascade to MBOL + CBOL shipments) ------------------- */

/** Generate a shipment id `SHP-YYYY-NNNN`. Same pattern as web. */
function genShipId(): string {
  const y = new Date().getFullYear();
  const r = String(Math.floor(1000 + Math.random() * 9000));
  return `SHP-${y}-${r}`;
}

export interface CbolPair {
  key: string;          // `${stopFrom}.${stopTo}` — also the cost-override key
  pickup: RouteStop;
  delivery: RouteStop;
  stopFrom: number;
  stopTo: number;
  legMiles: number;
}

/**
 * Build all valid pickup → delivery pairs from a route's stops. A
 * delivery pairs with every earlier pickup; downstream code picks
 * which orders ride on which CBOL.
 */
export function buildCbolPairs(stops: RouteStop[]): CbolPair[] {
  const list: RouteStop[] = Array.isArray(stops) ? stops : [];
  const pickups = list.filter((s) => s.type === 'pickup');
  const deliveries = list.filter((s) => s.type === 'delivery');
  const pairs: CbolPair[] = [];
  pickups.forEach((p) => {
    deliveries.forEach((d) => {
      const pSeq = (p.stop_seq || p.sequence || 0) as number;
      const dSeq = (d.stop_seq || d.sequence || 0) as number;
      if (dSeq > pSeq) {
        const pIdx = list.indexOf(p);
        const dIdx = list.indexOf(d);
        let legMiles = 0;
        for (let i = pIdx + 1; i <= dIdx; i++) {
          legMiles += parseFloat(String((list[i] as any).leg_miles || 0)) || 0;
        }
        pairs.push({
          key: `${pSeq}.${dSeq}`,
          pickup: p,
          delivery: d,
          stopFrom: pSeq,
          stopTo: dSeq,
          legMiles,
        });
      }
    });
  });
  return pairs;
}

/**
 * Pro-rate a CBOL's cost — caller-supplied override wins, otherwise
 * leg-miles share of the route's total override cost.
 */
export function getCbolCost(
  pair: CbolPair,
  totalLegMiles: number,
  totalRouteCost: number,
  override?: string | number,
): number {
  if (override !== undefined && override !== '' && Number.isFinite(Number(override))) {
    return Number(override) || 0;
  }
  if (totalLegMiles === 0 || totalRouteCost === 0) return 0;
  return Math.round((pair.legMiles / totalLegMiles) * totalRouteCost * 100) / 100;
}

/**
 * Auto-assign unplanned orders to CBOLs by matching origin/destination
 * cities. Mirrors the web ExecuteRouteModal's auto-match heuristic.
 */
export function autoAssignOrders(
  pairs: CbolPair[],
  unplannedOrders: any[],
): Record<string, string[]> {
  const normalize = (s: unknown) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const out: Record<string, string[]> = {};
  for (const pair of pairs) {
    const pCity = normalize(pair.pickup.city);
    const dCity = normalize(pair.delivery.city);
    const matched = (unplannedOrders || []).filter((o) => {
      const oOrigin = normalize(o.origin);
      const oDest = normalize(o.dest);
      return (
        (!!pCity && (oOrigin.includes(pCity) || pCity.includes(normalize((o.origin || '').split(',')[0]))))
        && (!!dCity && (oDest.includes(dCity) || dCity.includes(normalize((o.dest || '').split(',')[0]))))
      );
    });
    if (matched.length > 0) out[pair.key] = matched.map((o) => o.id);
  }
  return out;
}

export interface ExecutionPlan {
  masterShipment: Record<string, any>;
  childShipments: Record<string, any>[];
  orderUpdates: Array<{ id: string; shipment_id: string }>;
}

/**
 * Compose the cascade payload from an editable route + assignment map.
 * Pure helper so tests can assert the shape without hitting DbApi.
 *
 * Mirrors the web ExecuteRouteModal `execute()` body exactly so a
 * mobile-side execute creates the same MBOL/CBOL rows web would.
 */
export function buildRouteExecutionPlan(
  route: RouteTemplate,
  unplannedOrders: any[],
  assignments: Record<string, string[]>,
  costOverrides: Record<string, string | number> = {},
): ExecutionPlan {
  const stops = Array.isArray(route.stops) ? route.stops : [];
  const pickups = stops.filter((s) => s.type === 'pickup');
  const deliveries = stops.filter((s) => s.type === 'delivery');
  const pairs = buildCbolPairs(stops);
  const totalLegMiles = pairs.reduce((s, p) => s + p.legMiles, 0);
  const totalRouteCost = parseFloat(String(route.cost_override || 0)) || 0;

  const allOrderIds: string[] = Object.values(assignments || {}).flat();
  const ordersById = new Map<string, any>();
  for (const o of unplannedOrders || []) {
    if (o?.id) ordersById.set(o.id, o);
  }

  const firstPickup = pickups[0] || stops[0];
  const lastDelivery = deliveries[deliveries.length - 1] || stops[stops.length - 1];

  const assignedOrders = allOrderIds.map((id) => ordersById.get(id)).filter(Boolean);
  const readyDates = assignedOrders.map((o) => o.ready).filter(Boolean).sort();
  const dueDates = assignedOrders.map((o) => o.due).filter(Boolean).sort();
  const pickupDate = readyDates[0] || new Date().toISOString().slice(0, 10);
  const lastDueDate = dueDates[dueDates.length - 1] || null;
  const transitDays = parseInt(String(route.transit_days || ''), 10)
    || (lastDueDate && pickupDate
      ? Math.max(1, Math.round((new Date(lastDueDate).getTime() - new Date(pickupDate).getTime()) / 86400000))
      : null);
  const deliveryDate = lastDueDate
    || (transitDays
      ? new Date(new Date(pickupDate).getTime() + transitDays * 86400000).toISOString().slice(0, 10)
      : null);

  const masterId = genShipId();
  const masterShipment: Record<string, any> = {
    id: masterId,
    carrier: route.carrier || '',
    mode: route.mode || 'TL',
    origin: firstPickup?.location || `${firstPickup?.city || ''}, ${firstPickup?.state || ''}`.replace(/^, |, $/g, ''),
    dest: lastDelivery?.location || `${lastDelivery?.city || ''}, ${lastDelivery?.state || ''}`.replace(/^, |, $/g, ''),
    weight: assignedOrders.reduce((s, o) => s + (parseFloat(o?.weight) || 0), 0),
    pieces: assignedOrders.reduce((s, o) => s + (parseInt(o?.pieces, 10) || 0), 0),
    status: 'Planned',
    total_cost: totalRouteCost,
    order_ids: allOrderIds,
    miles: route.total_miles || totalLegMiles || 0,
    bol_type: 'MBOL',
    master_shipment_id: null,
    route_template_id: route.id,
    pickup_date: pickupDate,
    delivery_date: deliveryDate,
    service_level: (route as any).service_level || 'Standard',
  };

  const childShipments: Record<string, any>[] = [];
  const orderUpdates: Array<{ id: string; shipment_id: string }> = [];

  for (const pair of pairs) {
    const orderIds = assignments[pair.key] || [];
    if (orderIds.length === 0) continue;

    const childId = `${masterId}.${pair.stopFrom}.${pair.stopTo}`;
    const cbolCost = getCbolCost(pair, totalLegMiles, totalRouteCost, costOverrides[pair.key]);

    const cbolOrders = orderIds.map((id) => ordersById.get(id)).filter(Boolean);
    const cbolReady = cbolOrders.map((o) => o.ready).filter(Boolean).sort();
    const cbolDue = cbolOrders.map((o) => o.due).filter(Boolean).sort();
    const cbolPickup = cbolReady[0] || pickupDate;
    const cbolDelivery = cbolDue[cbolDue.length - 1] || deliveryDate;

    childShipments.push({
      id: childId,
      carrier: route.carrier || '',
      mode: route.mode || 'TL',
      origin: pair.pickup.location || `${pair.pickup.city || ''}, ${pair.pickup.state || ''}`.replace(/^, |, $/g, ''),
      dest: pair.delivery.location || `${pair.delivery.city || ''}, ${pair.delivery.state || ''}`.replace(/^, |, $/g, ''),
      weight: cbolOrders.reduce((s, o) => s + (parseFloat(o?.weight) || 0), 0),
      pieces: cbolOrders.reduce((s, o) => s + (parseInt(o?.pieces, 10) || 0), 0),
      status: 'Planned',
      total_cost: cbolCost,
      order_ids: orderIds,
      miles: pair.legMiles,
      bol_type: 'CBOL',
      master_shipment_id: masterId,
      stop_from: pair.stopFrom,
      stop_to: pair.stopTo,
      route_template_id: route.id,
      pickup_date: cbolPickup,
      delivery_date: cbolDelivery,
      service_level: (route as any).service_level || 'Standard',
    });

    for (const oid of orderIds) {
      orderUpdates.push({ id: oid, shipment_id: childId });
    }
  }

  return { masterShipment, childShipments, orderUpdates };
}

/**
 * Run the cascade against the backend. Inserts the MBOL, then each
 * CBOL, then patches every assigned order to point at its child
 * shipment. Mirrors web RouteApi.executeRoute step-for-step.
 */
export async function executeRoute(plan: ExecutionPlan): Promise<{ ok: true; masterId: string; childCount: number }> {
  if (!plan?.masterShipment?.id) {
    throw new Error('executeRoute: master shipment id is required');
  }
  if (!Array.isArray(plan.childShipments) || plan.childShipments.length === 0) {
    throw new Error('executeRoute: at least one child shipment is required');
  }
  await DbApi.upsert('shipments', plan.masterShipment);
  for (const child of plan.childShipments) {
    await DbApi.upsert('shipments', child);
  }
  for (const u of plan.orderUpdates || []) {
    await DbApi.patch('orders', u.id, { status: 'Planned', shipment_id: u.shipment_id });
  }
  return {
    ok: true,
    masterId: plan.masterShipment.id,
    childCount: plan.childShipments.length,
  };
}

/* ── Stats ───────────────────────────────────────────────────────── */

export interface RouteStats {
  total: number;
  active: number;
  inactive: number;
}

export function computeRouteStats(routes: any[]): RouteStats {
  return {
    total: routes.length,
    active: routes.filter((r) => (r.status || 'Active') === 'Active').length,
    inactive: routes.filter((r) => r.status === 'Inactive').length,
  };
}
