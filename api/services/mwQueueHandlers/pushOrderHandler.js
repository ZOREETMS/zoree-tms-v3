// ═══════════════════════════════════════════════════════════════════
// MW Queue Handler — PUSH_ORDER_TO_TMS
//
// Handler for the OMS-queued "release order to TMS" command. Delegates
// to the existing orderIngest service so this path matches what the
// /api/ingest/oms-orders endpoint already does — change_history rows
// written, ORDER_CREATED bus event emitted, SSE feed broadcast. No
// duplicate logic. CLAUDE_RULES §4: the worker stays a thin dispatcher,
// business logic lives in the dedicated service.
// ═══════════════════════════════════════════════════════════════════

const orderIngest = require('../orderIngest');

/**
 * @param {object} payload  — single-order shape the OMS UI builds
 *                            (mirrors /api/ingest/oms-orders body.orders[0]).
 * @returns {Promise<object>} ingest summary { accepted, ids, syncedAt }
 */
async function handlePushOrder(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('PUSH_ORDER_TO_TMS payload missing');
  }
  // Carry oms_order_ref through even when the OMS forgot to set it,
  // matching the inline OMS-side dispatcher (zoree-middleware.html
  // PUSH_ORDER_TO_TMS branch).
  const ingestPayload = Object.assign({ omsOrderRef: payload.id }, payload);
  return orderIngest.ingestOmsBatch({ orders: [ingestPayload] });
}

module.exports = { handlePushOrder };
