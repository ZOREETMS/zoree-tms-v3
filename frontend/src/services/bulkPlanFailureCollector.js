// ─────────────────────────────────────────────────────────────────────────────
// Bulk Plan Failure Collector (REQ-28)
//
// The bulk-planning pipeline in ordersService.bulkPlanOrders has many places
// where an order can silently drop out:
//   • No carrier returned a quote for the lane
//   • Best carrier's transit days don't honour ready / due
//   • A constraint (mode / service level) isn't satisfied
//   • The backend shipment insert or order patch failed
//
// Before this module existed, each of those sites pushed to a local closure,
// which bloated the already-large `bulkPlanOrders` function. This collector
// isolates three responsibilities so they can be unit-tested and reused:
//
//   1. `createFailureCollector()` — a tiny append-only buffer.
//   2. `dropReasonForLane(modeConstraint, serviceLevelConstraint)` — picks
//      the right code when a whole shipment-group loses its best quote.
//   3. `mapBackendErrorsToOrders(...)` — turns the backend's shipment/lane-
//      level errors into per-order Failure records, skipping orders that
//      survived on a different plan.
//
// Pure services-layer — no React, no fetch, no I/O.
// ─────────────────────────────────────────────────────────────────────────────

import { FAILURE_CODES, makeFailure } from "../types/planningFailure";
import { classifyBackendError } from "./planningFailureCatalog";

/**
 * Build a small append-only collector for Failure records.
 *
 * @returns {{
 *   add:  (orderId: string, code: string, details?: string) => void,
 *   addMany: (orderIds: Array<string | { id: string }>, code: string, details?: string) => void,
 *   list: () => Array<{ orderId: string, code: string, details: string }>,
 * }}
 */
export function createFailureCollector() {
  const items = [];

  function add(orderId, code, details = "") {
    if (!orderId) return;
    items.push(makeFailure(orderId, code, details));
  }

  function addMany(orderIdsOrOrders, code, details = "") {
    if (!Array.isArray(orderIdsOrOrders)) return;
    for (const entry of orderIdsOrOrders) {
      const id = typeof entry === "string" ? entry : entry && entry.id;
      if (id) add(id, code, details);
    }
  }

  return {
    add,
    addMany,
    list: () => items.slice(),
  };
}

/**
 * When a whole shipment-group loses its best quote, the reason is not the
 * same in every case — a lane that asked for LTL / Next-Day and got nothing
 * should surface the constraint, not a generic "no quote".
 *
 * @param {string=} modeConstraint
 * @param {string=} serviceLevelConstraint
 * @returns {string}   — one of FAILURE_CODES.*
 */
export function dropReasonForLane(modeConstraint, serviceLevelConstraint) {
  if (modeConstraint)         return FAILURE_CODES.MODE_CONSTRAINT_UNMET;
  if (serviceLevelConstraint) return FAILURE_CODES.SERVICE_LEVEL_UNMET;
  return FAILURE_CODES.NO_CARRIER_QUOTE;
}

/**
 * Correlate backend errors from `/api/bulk-plan/execute` back to the orders
 * they were carrying. The backend emits errors keyed by `lane` (from
 * `plan.laneKey`) or `shipId`; we match on laneKey and attribute the error
 * to every orderId on that plan — unless the order survived on a different
 * plan / shipment.
 *
 * @param {object} params
 * @param {Array<{ error?: string, lane?: string, shipId?: string }>} params.backendErrors
 * @param {Array<{ laneKey?: string, orderIds?: string[] }>}           params.plans
 * @param {Set<string>}                                                params.plannedOrderIds
 * @returns {Array<{ orderId: string, code: string, details: string }>}
 */
export function mapBackendErrorsToOrders({ backendErrors = [], plans = [], plannedOrderIds = new Set() } = {}) {
  const failures = [];
  for (const err of backendErrors) {
    if (!err) continue;
    const plan = plans.find((p) => err.lane && p.laneKey === err.lane);
    const orderIds = plan ? (plan.orderIds || []) : [];
    const code = classifyBackendError(err.error);
    for (const oid of orderIds) {
      if (plannedOrderIds.has(oid)) continue; // survived via a different plan
      failures.push(makeFailure(oid, code, err.error || ""));
    }
  }
  return failures;
}
