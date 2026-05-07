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
 *   1. ratePlanForOrder(order)   →  { plan, quote }   (or failure code)
 *   2. executeOrderPlan(plan)    →  { shipment, errors }
 *
 * Pure service layer: no React state, no UI side-effects. The screen
 * orchestrates the confirm dialog + refreshData() itself, matching the
 * structure of the existing `useBulkPlan` hook. Reusing
 * `planAllLanes` keeps consolidation/rating logic in ONE place
 * (`shared/services/bulkPlanService.js`) — see CLAUDE_RULES Rule 6.
 */

import { BulkPlanApi } from '../lib/api';
import { buildSingleOrderLane } from '../shared/utils/laneUtils';
import { planAllLanes } from '../shared/services/bulkPlanService';

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
 */
export function isFailure(
  r: SingleOrderPlanResult | SingleOrderPlanFailure,
): r is SingleOrderPlanFailure {
  return (r as SingleOrderPlanFailure).code !== undefined;
}
