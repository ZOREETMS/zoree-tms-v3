// ─────────────────────────────────────────────────────────────────────────────
// Planning failure catalog (REQ-28)
//
// Human-readable side of failure reasons. The wire shape + code enum live in
// `types/planningFailure.js`; this file maps codes → sentences and groups
// them into broad categories for the Excel export.
//
// When the planner drops an order (no quote, carrier date conflict, past-due,
// DB insert error, ...) it builds a Failure via `makeFailure(...)` from the
// types module. UI/exporter callers then use `describeFailure()` here to
// render "Planning failed: <reason>".
// ─────────────────────────────────────────────────────────────────────────────

import { FAILURE_CODES } from "../types/planningFailure";

// Re-export the enum so existing callers that only want the codes can keep
// importing from this module and don't have to know about the types/ split.
export { FAILURE_CODES } from "../types/planningFailure";
export { makeFailure } from "../types/planningFailure";

const FAILURE_MESSAGES = {
  [FAILURE_CODES.NO_CARRIER_QUOTE]:
    "No carrier returned a quote for this lane / weight.",
  [FAILURE_CODES.DATES_INCOMPATIBLE]:
    "Ready / due dates are not compatible with the cheapest carrier's transit days.",
  [FAILURE_CODES.PAST_DUE]:
    "Due date is already in the past.",
  [FAILURE_CODES.NO_MATCHING_RATE]:
    "No rate card matches this lane, mode, or service level.",
  [FAILURE_CODES.MODE_CONSTRAINT_UNMET]:
    "No carrier satisfies the required shipping mode (LTL / TL / ...).",
  [FAILURE_CODES.SERVICE_LEVEL_UNMET]:
    "No carrier satisfies the required service level.",
  [FAILURE_CODES.BACKEND_INSERT_FAILED]:
    "Shipment row could not be written (database insert rejected).",
  [FAILURE_CODES.ORDER_PATCH_FAILED]:
    "Orders could not be linked to the new shipment (database patch rejected).",
  [FAILURE_CODES.UNKNOWN]:
    "Planning failed for an unrecognised reason.",
};

/** Broad category string used for grouping in the Excel export. */
export function failureCategory(code) {
  switch (code) {
    case FAILURE_CODES.NO_CARRIER_QUOTE:
    case FAILURE_CODES.NO_MATCHING_RATE:
    case FAILURE_CODES.MODE_CONSTRAINT_UNMET:
    case FAILURE_CODES.SERVICE_LEVEL_UNMET:
      return "Carrier / Rate";
    case FAILURE_CODES.DATES_INCOMPATIBLE:
    case FAILURE_CODES.PAST_DUE:
      return "Dates";
    case FAILURE_CODES.BACKEND_INSERT_FAILED:
    case FAILURE_CODES.ORDER_PATCH_FAILED:
      return "Database";
    default:
      return "Other";
  }
}

/**
 * Turn a Failure into a user-visible sentence.
 * @param {{ code: string, details?: string }} failure
 */
export function describeFailure(failure) {
  if (!failure) return FAILURE_MESSAGES[FAILURE_CODES.UNKNOWN];
  const base = FAILURE_MESSAGES[failure.code] || FAILURE_MESSAGES[FAILURE_CODES.UNKNOWN];
  return failure.details ? `${base} (${failure.details})` : base;
}

/**
 * Classify a raw error string coming back from the backend / planner into
 * one of our catalog codes. Conservative — unknown strings fall through to
 * UNKNOWN so we never misrepresent the real cause.
 */
export function classifyBackendError(rawMessage = "") {
  const s = String(rawMessage).toLowerCase();
  if (!s) return FAILURE_CODES.UNKNOWN;
  if (s.includes("batch order patch"))                       return FAILURE_CODES.ORDER_PATCH_FAILED;
  if (s.includes("db insert") || s.includes("insert failed")) return FAILURE_CODES.BACKEND_INSERT_FAILED;
  if (s.includes("dock columns missing"))                    return FAILURE_CODES.BACKEND_INSERT_FAILED;
  return FAILURE_CODES.UNKNOWN;
}
