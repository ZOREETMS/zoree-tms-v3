/**
 * Bulk plan failure collector (mobile mirror of REQ-28).
 *
 * Web parity reference:
 *   frontend/src/services/bulkPlanFailureCollector.js
 *
 * Responsibilities, isolated for testability + reuse:
 *   1. createFailureCollector()            — append-only buffer
 *   2. dropReasonForLane(mode, sl)         — picks the right code
 *      when a whole shipment-group loses its best quote
 *   3. mapBackendErrorsToOrders(...)       — turns backend execute()
 *      lane errors into per-order Failure records, skipping orders
 *      that survived on a different plan
 *
 * Pure services-layer: no React, no fetch, no I/O.
 */

import {
  FAILURE_CODES,
  makeFailure,
  type FailureCode,
  type PlanningFailure,
} from '../types/planningFailure';
import { classifyBackendError } from './planningFailureCatalog';

export interface FailureCollector {
  add: (orderId: string, code: string, details?: string) => void;
  addMany: (
    orderIdsOrOrders: ReadonlyArray<string | { id: string }>,
    code: string,
    details?: string,
  ) => void;
  list: () => PlanningFailure[];
}

/** Build a small append-only collector for Failure records. */
export function createFailureCollector(): FailureCollector {
  const items: PlanningFailure[] = [];

  function add(orderId: string, code: string, details: string = ''): void {
    if (!orderId) return;
    items.push(makeFailure(orderId, code, details));
  }

  function addMany(
    orderIdsOrOrders: ReadonlyArray<string | { id: string }>,
    code: string,
    details: string = '',
  ): void {
    if (!Array.isArray(orderIdsOrOrders)) return;
    for (const entry of orderIdsOrOrders) {
      const id = typeof entry === 'string' ? entry : entry?.id;
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
 * When a whole shipment-group loses its best quote, the reason isn't
 * always "no quote" — a lane that asked for LTL / Next-Day and got
 * nothing should surface the constraint, not a generic miss.
 */
export function dropReasonForLane(
  modeConstraint?: string,
  serviceLevelConstraint?: string,
): FailureCode {
  if (modeConstraint)         return FAILURE_CODES.MODE_CONSTRAINT_UNMET;
  if (serviceLevelConstraint) return FAILURE_CODES.SERVICE_LEVEL_UNMET;
  return FAILURE_CODES.NO_CARRIER_QUOTE;
}

export interface BackendErrorEntry {
  error?: string;
  lane?: string;
  shipId?: string;
}

export interface PlanForCorrelation {
  laneKey?: string;
  orderIds?: string[];
}

export interface MapBackendErrorsParams {
  backendErrors?: BackendErrorEntry[];
  plans?: PlanForCorrelation[];
  plannedOrderIds?: ReadonlySet<string>;
}

/**
 * Correlate backend errors from `/api/bulk-plan/execute` back to the
 * orders they were carrying. Backend emits errors keyed by `lane`
 * (matching `plan.laneKey`); we attribute the error to every orderId
 * on that plan — unless the order already survived on a different
 * shipment, in which case we don't fail it.
 */
export function mapBackendErrorsToOrders({
  backendErrors = [],
  plans = [],
  plannedOrderIds = new Set<string>(),
}: MapBackendErrorsParams = {}): PlanningFailure[] {
  const failures: PlanningFailure[] = [];
  for (const err of backendErrors) {
    if (!err) continue;
    const plan = plans.find((p) => err.lane && p.laneKey === err.lane);
    const orderIds = plan ? plan.orderIds || [] : [];
    const code = classifyBackendError(err.error);
    for (const oid of orderIds) {
      if (plannedOrderIds.has(oid)) continue; // survived via a different plan
      failures.push(makeFailure(oid, code, err.error || ''));
    }
  }
  return failures;
}
