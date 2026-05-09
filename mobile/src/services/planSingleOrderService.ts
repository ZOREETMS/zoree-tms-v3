/**
 * planSingleOrderService — single-order planning for mobile.
 *
 * Why this exists
 * ───────────────
 * The mobile OrderDetailScreen "Plan" button used to fire
 * `OrdersApi.update(id, { status: 'Planned' })` directly. That hits
 * `PATCH /api/orders/:id` which is a generic field editor — it does
 * NOT rate the order, does NOT create a shipment row, and does NOT
 * set `shipment_id`. The result was an orphan state: order.status =
 * 'Planned' but no matching row in `shipments` (e.g. ORD-2026-991550).
 *
 * The correct planning path on web goes through `openPlanModal` →
 * `BulkPlanApi.rate` → `BulkPlanApi.execute` → `bulkPlanExecution.js`
 * which inserts the shipment + batch-PATCHes the orders with both
 * `status` and `shipment_id` in one round-trip.
 *
 * This service exposes the same path as a two-step flow so the mobile
 * detail screen can show the user the matched quote before committing:
 *
 *   1. ratePlanForOrder(order)         →  { plan, summary }   (winner only)
 *   1b. rateAllCarriersForOrder(order) →  { quotes }           (all options)
 *   1c. buildPlanFromQuote(order, q)   →  plan                 (after picker)
 *   2. executeOrderPlan(plan)          →  { shipment, errors }
 *
 * Why two rating entry points?
 * `ratePlanForOrder` (legacy) returns just the winning carrier and is
 * useful for one-tap "plan with cheapest" flows. `rateAllCarriersForOrder`
 * returns every viable carrier so the OrderDetailScreen carrier picker
 * can show the user the full list — fixing the "I can't see all the
 * different carrier options" UX gap where the prior flow only ever
 * surfaced one carrier in the confirm dialog.
 *
 * Pure service layer: no React state, no UI side-effects. The screen
 * orchestrates the confirm dialog + refreshData() itself, matching the
 * structure of the existing `useBulkPlan` hook. Rating helpers reuse
 * `buildPlan` / `calcDates` so consolidation/rating logic stays in ONE
 * place (`shared/services/bulkPlanService.js`) — see CLAUDE_RULES Rule 6.
 */

import { BulkPlanApi } from '../lib/api';
import { buildSingleOrderLane } from '../shared/utils/laneUtils';
import { planAllLanes, buildPlan, calcDates } from '../shared/services/bulkPlanService';

/* ── Public types ─────────────────────────────────────────────── */

export type PlanSingleOrderFailureCode =
  | 'NO_CARRIER_QUOTE'
  | 'INVALID_ORDER'
  | 'PAST_DUE_DATE';

export interface SingleOrderPlanResult {
  /** The plan object that `BulkPlanApi.execute` consumes. */
  plan: any;
  /** Carrier / cost / dates summary, suitable for a confirm dialog. */
  summary: {
    carrier: string;
    mode: string;
    totalCost: number;
    pickupDate: string | null;
    deliveryDate: string | null;
    transitDays: number | null;
  };
}

export interface SingleOrderPlanFailure {
  code: PlanSingleOrderFailureCode;
  message: string;
}

export interface SingleOrderExecuteResult {
  /** The persisted shipment row (id, carrier, …). */
  shipment: any;
  /** Per-lane errors from the bulk-plan execute endpoint. */
  errors: Array<{ shipId?: string; lane?: string; error: string }>;
}

/**
 * One carrier option in the OrderDetail picker. We deliberately keep
 * this narrower than the raw rate-engine quote shape — the picker
 * component only needs display fields. The opaque `rawQuote` is
 * round-tripped back into `buildPlanFromQuote` so we never have to
 * re-derive base/fuel/accessorials in the UI layer.
 */
export interface SingleOrderCarrierQuote {
  carrier: string;
  mode: string;
  serviceLevel: string;
  totalCost: number;
  transitDays: number | null;
  pickupDate: string | null;
  deliveryDate: string | null;
  /** Carrier flagged "preferred" by the lane-pref / carrier-master config. */
  preferred: boolean;
  /** API-side recommendation flag (validQuotes[0] in /api/bulk-plan/rate). */
  recommended: boolean;
  /** Opaque rate-engine quote — handed back to buildPlanFromQuote. */
  rawQuote: any;
}

export interface SingleOrderQuotesResult {
  /** Sorted list of all viable carrier quotes (server's order is preserved). */
  quotes: SingleOrderCarrierQuote[];
}

/* ── Internal helpers ─────────────────────────────────────────── */

/**
 * Today as YYYY-MM-DD (local). We deliberately use the local date
 * rather than UTC because dueDate / readyDate columns are date-only.
 */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isPastDue(order: any): boolean {
  const due = order?.dueDate || order?.due_date || order?.due;
  if (!due) return false;
  return String(due).slice(0, 10) < todayIso();
}

/* ── Step 1: rate ──────────────────────────────────────────────── */

/**
 * Rate a single order. Returns a plan ready for execute, or a
 * structured failure the screen can render.
 *
 * Rules-of-the-road
 * ─────────────────
 * • Past-due orders are rejected here (mirrors web's
 *   `validateAndFailPastDueOrders` guard in OrdersPage.openPlanModal).
 * • If `planAllLanes` returns `failedOrderIds.includes(order.id)` we
 *   surface NO_CARRIER_QUOTE — same code the bulk-plan screen uses,
 *   so downstream UI can render one consistent failure message.
 */
export async function ratePlanForOrder(
  order: any,
  optimizeBy: 'cost' | 'transit' = 'cost',
): Promise<SingleOrderPlanResult | SingleOrderPlanFailure> {
  if (!order || !order.id) {
    return { code: 'INVALID_ORDER', message: 'Order is missing required fields.' };
  }
  if (isPastDue(order)) {
    return {
      code: 'PAST_DUE_DATE',
      message: `Due date ${order.dueDate || order.due} is in the past — order cannot be planned.`,
    };
  }

  const lane = buildSingleOrderLane(order);
  const result = await planAllLanes([lane], [order], optimizeBy);

  const plan = Array.isArray(result.plans) ? result.plans[0] : null;
  if (!plan || (result.failedOrderIds || []).includes(order.id)) {
    return {
      code: 'NO_CARRIER_QUOTE',
      message: 'No carriers returned a quote for this lane. Check rates or enable CarrierConnect.',
    };
  }

  return {
    plan,
    summary: {
      carrier:      plan.carrier      || 'Unknown',
      mode:         plan.mode         || 'LTL',
      totalCost:    Number(plan.totalCost || 0),
      pickupDate:   plan.pickupDate   || null,
      deliveryDate: plan.deliveryDate || null,
      transitDays:  plan.transitDays  ?? null,
    },
  };
}

/* ── Step 1b: rate ALL carriers (carrier-picker variant) ───────── */

/**
 * Rate a single order and return EVERY viable carrier quote — not
 * just the winner. Powers the OrderDetailScreen carrier picker so
 * the user can see all options before committing.
 *
 * Why this is separate from `ratePlanForOrder`
 * ────────────────────────────────────────────
 * `planAllLanes` (and its helper `rateLane`) intentionally collapse
 * the response to `bestQuote` — that fits the bulk-plan flow which
 * one-shot-executes the cheapest plan per lane. The mobile single-
 * order screen needs the full list, so we call `BulkPlanApi.rate`
 * directly here. Consolidation logic doesn't apply (one order →
 * one lane), so bypassing `planLaneWithSplit` is safe.
 *
 * Mirrors the past-due / invalid-order guards from `ratePlanForOrder`
 * so callers that switch between the two paths see consistent
 * failure codes.
 */
export async function rateAllCarriersForOrder(
  order: any,
  optimizeBy: 'cost' | 'transit' = 'cost',
): Promise<SingleOrderQuotesResult | SingleOrderPlanFailure> {
  if (!order || !order.id) {
    return { code: 'INVALID_ORDER', message: 'Order is missing required fields.' };
  }
  if (isPastDue(order)) {
    return {
      code: 'PAST_DUE_DATE',
      message: `Due date ${order.dueDate || order.due} is in the past — order cannot be planned.`,
    };
  }

  const lane = buildSingleOrderLane(order);
  let res: any;
  try {
    res = await BulkPlanApi.rate([lane], optimizeBy);
  } catch (e: any) {
    return {
      code: 'NO_CARRIER_QUOTE',
      message: e?.message || 'Rating service unreachable.',
    };
  }

  const laneResult = Array.isArray(res?.results)
    ? res.results.find((r: any) => r.laneKey === lane.laneKey) || res.results[0]
    : null;

  // Server-side gate: transitDays > 0. Same filter the API uses to
  // pick `bestQuote`, so the picker never offers a quote that would
  // immediately fail `buildPlan`'s `calcDates` check.
  const rawQuotes: any[] = Array.isArray(laneResult?.quotes)
    ? laneResult.quotes.filter((q: any) => Number(q?.transitDays) > 0)
    : [];

  if (rawQuotes.length === 0) {
    return {
      code: 'NO_CARRIER_QUOTE',
      message: 'No carriers returned a quote for this lane. Check rates or enable CarrierConnect.',
    };
  }

  const dueDate   = order.dueDate   || order.due_date   || order.due   || '';
  const readyDate = order.readyDate || order.ready_date || order.ready || '';

  const quotes: SingleOrderCarrierQuote[] = rawQuotes.map((q) => {
    // Reuse the same date math as the bulk-plan path so picker
    // pickup/delivery dates exactly match what `executeOrderPlan`
    // will persist.
    const dates = calcDates(q, dueDate, readyDate);
    return {
      carrier:      q.carrier || 'Unknown',
      mode:         q.mode || 'LTL',
      serviceLevel: q.serviceLevel || 'Standard',
      totalCost:    Number(q.totalCharge || 0),
      transitDays:  dates.transit ?? null,
      pickupDate:   dates.pickup  ?? null,
      deliveryDate: dates.delivery ?? null,
      preferred:    Boolean(q.preferred),
      recommended:  Boolean(q.recommended),
      rawQuote:     q,
    };
  });

  return { quotes };
}

/* ── Step 1c: build a plan for a chosen quote ──────────────────── */

/**
 * Materialise an executable plan from a quote the user picked in the
 * carrier picker. Delegates to the shared `buildPlan` helper so the
 * shipment row written by `executeOrderPlan` is shape-identical to
 * one built via the bulk-plan path (same rate / fuel / accessorials
 * breakdown, same date math, same equipment snapshot).
 *
 * Returns `null` if `calcDates` rejects the quote (no transit time).
 * Callers should treat that as "this carrier can't plan today" and
 * either fall back to another option or surface a friendly error.
 */
export function buildPlanFromQuote(order: any, quote: SingleOrderCarrierQuote): any {
  if (!order || !quote?.rawQuote) return null;
  const lane = buildSingleOrderLane(order);
  return buildPlan(lane, quote.rawQuote, [order]);
}

/* ── Step 2: execute ──────────────────────────────────────────── */

/**
 * Commit a previously-rated plan. Calls the same endpoint the bulk
 * screen uses, so server-side audit/cascade logic runs identically
 * (status → 'Planned', shipment_id set, change_history action='plan',
 * BOL document inserted, dock-mirror to OMS).
 */
export async function executeOrderPlan(plan: any): Promise<SingleOrderExecuteResult> {
  if (!plan) {
    return { shipment: null, errors: [{ error: 'Missing plan' }] };
  }
  const res = await BulkPlanApi.execute([plan]);
  const shipments = Array.isArray(res?.shipments) ? res.shipments : [];
  return {
    shipment: shipments[0] || null,
    errors:   Array.isArray(res?.errors) ? res.errors : [],
  };
}

/**
 * Convenience type-guard so callers can `if (isFailure(r)) …`.
 *
 * Widened to accept `SingleOrderQuotesResult` too so the carrier-picker
 * flow on OrderDetailScreen can use the same guard without a cast — both
 * rate paths return `… | SingleOrderPlanFailure` with the same failure
 * shape, so one guard fits both.
 */
export function isFailure(
  r: SingleOrderPlanResult | SingleOrderQuotesResult | SingleOrderPlanFailure,
): r is SingleOrderPlanFailure {
  return (r as SingleOrderPlanFailure).code !== undefined;
}
