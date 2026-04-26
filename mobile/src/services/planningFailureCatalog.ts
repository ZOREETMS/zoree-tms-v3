/**
 * Planning failure catalog (mobile mirror of REQ-28).
 *
 * Maps FAILURE_CODES to human sentences and broad categories. The
 * code enum + record factory live in types/planningFailure.ts so
 * adding a new code is a one-place change there, then registering
 * its message here.
 *
 * Web parity reference: frontend/src/services/planningFailureCatalog.js
 */

import {
  FAILURE_CODES,
  type FailureCode,
  type PlanningFailure,
} from '../types/planningFailure';

const FAILURE_MESSAGES: Record<FailureCode, string> = {
  [FAILURE_CODES.NO_CARRIER_QUOTE]:
    'No carrier returned a quote for this lane / weight.',
  [FAILURE_CODES.DATES_INCOMPATIBLE]:
    "Ready / due dates are not compatible with the cheapest carrier's transit days.",
  [FAILURE_CODES.PAST_DUE]:
    'Due date is already in the past.',
  [FAILURE_CODES.NO_MATCHING_RATE]:
    'No rate card matches this lane, mode, or service level.',
  [FAILURE_CODES.MODE_CONSTRAINT_UNMET]:
    'No carrier satisfies the required shipping mode (LTL / TL / ...).',
  [FAILURE_CODES.SERVICE_LEVEL_UNMET]:
    'No carrier satisfies the required service level.',
  [FAILURE_CODES.BACKEND_INSERT_FAILED]:
    'Shipment row could not be written (database insert rejected).',
  [FAILURE_CODES.ORDER_PATCH_FAILED]:
    'Orders could not be linked to the new shipment (database patch rejected).',
  [FAILURE_CODES.UNKNOWN]:
    'Planning failed for an unrecognised reason.',
};

/** Broad category used for grouping in summary UIs and Excel exports. */
export function failureCategory(code: FailureCode | string): string {
  switch (code) {
    case FAILURE_CODES.NO_CARRIER_QUOTE:
    case FAILURE_CODES.NO_MATCHING_RATE:
    case FAILURE_CODES.MODE_CONSTRAINT_UNMET:
    case FAILURE_CODES.SERVICE_LEVEL_UNMET:
      return 'Carrier / Rate';
    case FAILURE_CODES.DATES_INCOMPATIBLE:
    case FAILURE_CODES.PAST_DUE:
      return 'Dates';
    case FAILURE_CODES.BACKEND_INSERT_FAILED:
    case FAILURE_CODES.ORDER_PATCH_FAILED:
      return 'Database';
    default:
      return 'Other';
  }
}

/**
 * Turn a Failure record into a user-visible sentence. If `details` is
 * present, append it parenthetically — surfacing backend error text
 * gives the user enough to file a useful bug report.
 */
export function describeFailure(failure: Partial<PlanningFailure> | null | undefined): string {
  if (!failure) return FAILURE_MESSAGES[FAILURE_CODES.UNKNOWN];
  const code = (failure.code as FailureCode) || FAILURE_CODES.UNKNOWN;
  const base = FAILURE_MESSAGES[code] || FAILURE_MESSAGES[FAILURE_CODES.UNKNOWN];
  return failure.details ? `${base} (${failure.details})` : base;
}

/**
 * Classify a raw error string from the backend planner into one of
 * our catalog codes. Conservative — unknown strings fall through to
 * UNKNOWN so we never misrepresent the real cause.
 */
export function classifyBackendError(rawMessage: string = ''): FailureCode {
  const s = String(rawMessage).toLowerCase();
  if (!s) return FAILURE_CODES.UNKNOWN;
  if (s.includes('batch order patch'))                       return FAILURE_CODES.ORDER_PATCH_FAILED;
  if (s.includes('db insert') || s.includes('insert failed')) return FAILURE_CODES.BACKEND_INSERT_FAILED;
  if (s.includes('dock columns missing'))                    return FAILURE_CODES.BACKEND_INSERT_FAILED;
  return FAILURE_CODES.UNKNOWN;
}

/* Re-export the enum + factory so existing callers that only want
 * the codes can keep importing from a single module without having
 * to know about the types/ split. Mirrors the web's pattern. */
export { FAILURE_CODES, makeFailure } from '../types/planningFailure';
export type { FailureCode, PlanningFailure } from '../types/planningFailure';
