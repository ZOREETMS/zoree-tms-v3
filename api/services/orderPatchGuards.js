// ═══════════════════════════════════════════════════════════════════
// Order Patch Guards — invariants enforced before persisting an
// orders-table mutation, kept out of the route handlers per
// CLAUDE_RULES § 6 (no large inline logic blocks) and § 4 (all API
// calls through the services layer).
//
// Each guard is a pure function over `(patch, beforeRow)` returning
// a small descriptor the caller can act on. Routes stay one-liners;
// tests can target the guard directly without spinning up Express.
//
// Single-source-of-truth references:
//   - api/constants/orderStatus.js     — status names + predicates
//   - api/services/orderMutations.js   — column-shape patch builder
// ═══════════════════════════════════════════════════════════════════

const { isOrderPostTenderAccept } = require('../constants/orderStatus');

// Date column keys produced by apiOrderToDbPatch (`ready`, `due`) plus
// the snake_case forms (`ready_date`, `due_date`) for any future
// caller that hands the guard a raw DB-shape patch. Listed here so
// the guard does not have to know which mapper produced the patch.
const ORDER_DATE_FIELD_KEYS = Object.freeze([
  'ready',
  'due',
  'ready_date',
  'due_date',
]);

const ERROR_CODE_DATES_FROZEN = 'ORDER_DATES_FROZEN_POST_TENDER';

/**
 * Strip frozen-after-tender date fields from `patch` in place.
 *
 * Returns the array of field names that were removed; empty when the
 * order is pre-tender or the patch contained no date fields. The
 * mutate-in-place shape matches the surrounding code in
 * `apiOrderToDbPatch` callers — the route already has the patch
 * object and we want to avoid an extra allocation per request.
 *
 * Pure with respect to the database: this function never reads or
 * writes; the caller is responsible for fetching `beforeRow.status`
 * and for persisting whatever survives the strip.
 *
 * @param {object} patch       The DB-shape patch the caller is about to apply.
 * @param {object} beforeRow   Current orders row (only `status` is read).
 * @returns {string[]}         Field names that were stripped.
 */
function stripFrozenDateFields(patch, beforeRow) {
  if (!patch || typeof patch !== 'object') return [];
  if (!beforeRow || !isOrderPostTenderAccept(beforeRow.status)) return [];

  const stripped = [];
  for (const key of ORDER_DATE_FIELD_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      delete patch[key];
      stripped.push(key);
    }
  }
  return stripped;
}

/**
 * Compose a response descriptor for the PATCH /api/orders/:id route.
 *
 * Strategy:
 *   - If the order is post-tender AND the patch is entirely composed
 *     of frozen date fields, REJECT with 409 — the client's intent
 *     was clearly to edit a frozen field.
 *   - If the order is post-tender AND the patch mixes date + other
 *     fields, STRIP the date fields silently and let the rest of the
 *     update proceed. A response header (`X-Order-Dates-Frozen`)
 *     surfaces the silent drop so it is debuggable.
 *   - Otherwise, pass through unchanged.
 *
 * The route owns the HTTP layer — this function just describes what
 * the route should do, in a shape that is trivially unit-testable.
 *
 * @returns {{
 *   reject: boolean,
 *   statusCode: number | null,
 *   body: object | null,
 *   strippedFields: string[],
 * }}
 */
function applyPostTenderDateGuard(patch, beforeRow) {
  const strippedFields = stripFrozenDateFields(patch, beforeRow);

  if (!strippedFields.length) {
    return { reject: false, statusCode: null, body: null, strippedFields };
  }

  const patchHasOtherFields = Object.keys(patch).length > 0;
  if (patchHasOtherFields) {
    return { reject: false, statusCode: null, body: null, strippedFields };
  }

  // Patch was entirely frozen date fields — nothing left to apply.
  const orderId = beforeRow && beforeRow.id ? String(beforeRow.id) : '<unknown>';
  return {
    reject: true,
    statusCode: 409,
    body: {
      error:  `Order ${orderId} is in status '${beforeRow.status}' — ready/due dates are frozen after tender acceptance.`,
      code:   ERROR_CODE_DATES_FROZEN,
      fields: strippedFields,
    },
    strippedFields,
  };
}

module.exports = {
  stripFrozenDateFields,
  applyPostTenderDateGuard,
  ORDER_DATE_FIELD_KEYS,
  ERROR_CODE_DATES_FROZEN,
};
