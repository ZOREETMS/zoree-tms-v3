/**
 * Shared types for planning failures (mobile mirror of REQ-28).
 *
 * Web parity reference: frontend/src/types/planningFailure.js.
 * Codes must stay aligned with the web — the bulk-plan failure shapes
 * are part of the wire contract between the API, the planner, and the
 * UIs that surface failure reasons to the user.
 *
 * A Failure is:
 *   {
 *     orderId: string,   // the order that dropped out of a plan
 *     code:    string,   // one of FAILURE_CODES.*
 *     details: string,   // optional free-text from the underlying error
 *   }
 *
 * Add a new code? Mirror it on web first, then register a human
 * message in services/planningFailureCatalog.ts.
 */

export const FAILURE_CODES = Object.freeze({
  NO_CARRIER_QUOTE:      'NO_CARRIER_QUOTE',
  DATES_INCOMPATIBLE:    'DATES_INCOMPATIBLE',
  PAST_DUE:              'PAST_DUE',
  NO_MATCHING_RATE:      'NO_MATCHING_RATE',
  MODE_CONSTRAINT_UNMET: 'MODE_CONSTRAINT_UNMET',
  SERVICE_LEVEL_UNMET:   'SERVICE_LEVEL_UNMET',
  BACKEND_INSERT_FAILED: 'BACKEND_INSERT_FAILED',
  ORDER_PATCH_FAILED:    'ORDER_PATCH_FAILED',
  UNKNOWN:               'UNKNOWN',
} as const);

export type FailureCode = (typeof FAILURE_CODES)[keyof typeof FAILURE_CODES];

export interface PlanningFailure {
  orderId: string;
  code: FailureCode;
  details: string;
}

/**
 * Factory for a well-formed Failure record.
 * Unknown / typo'd codes fall back to UNKNOWN so a misuse never
 * persists a code that downstream code can't render.
 */
export function makeFailure(
  orderId: string,
  code: string,
  details: string = '',
): PlanningFailure {
  const safeCode: FailureCode = (FAILURE_CODES as Record<string, FailureCode>)[code]
    ? (code as FailureCode)
    : FAILURE_CODES.UNKNOWN;
  return {
    orderId,
    code: safeCode,
    details: details || '',
  };
}
