// ─────────────────────────────────────────────────────────────────────────────
// Shared types for planning failures (REQ-28)
//
// This module is the canonical definition of a planning-failure record.
// Every layer (the planner in ordersService, the catalog of human messages,
// the bulk-plan results exporter, and the UI panel) imports FAILURE_CODES
// and `makeFailure` from here so the shape never drifts.
//
// A Failure is:
//   {
//     orderId: string,   // the order that dropped out of a plan
//     code:    string,   // one of FAILURE_CODES.*
//     details: string,   // optional free-text detail from the underlying error
//   }
//
// Adding a new reason code? Add it here first, then register its human
// message in services/planningFailureCatalog.js.
// ─────────────────────────────────────────────────────────────────────────────

export const FAILURE_CODES = Object.freeze({
  NO_CARRIER_QUOTE:        "NO_CARRIER_QUOTE",
  DATES_INCOMPATIBLE:      "DATES_INCOMPATIBLE",
  PAST_DUE:                "PAST_DUE",
  NO_MATCHING_RATE:        "NO_MATCHING_RATE",
  MODE_CONSTRAINT_UNMET:   "MODE_CONSTRAINT_UNMET",
  SERVICE_LEVEL_UNMET:     "SERVICE_LEVEL_UNMET",
  BACKEND_INSERT_FAILED:   "BACKEND_INSERT_FAILED",
  ORDER_PATCH_FAILED:      "ORDER_PATCH_FAILED",
  UNKNOWN:                 "UNKNOWN",
});

/**
 * Factory for a well-formed Failure record.
 * Unknown codes fall back to FAILURE_CODES.UNKNOWN so we never persist a
 * bogus code.
 *
 * @param {string}  orderId
 * @param {string}  code     — one of FAILURE_CODES.*
 * @param {string=} details  — optional free-text detail.
 * @returns {{ orderId: string, code: string, details: string }}
 */
export function makeFailure(orderId, code, details = "") {
  return {
    orderId,
    code: FAILURE_CODES[code] ? code : FAILURE_CODES.UNKNOWN,
    details: details || "",
  };
}
