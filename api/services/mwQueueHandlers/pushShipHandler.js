// ═══════════════════════════════════════════════════════════════════
// MW Queue Handler — PUSH_SHIP_STATUS
//
// Handler for the OMS-queued "ship-confirm" command. Delegates to the
// existing shipConfirm service so this path is identical to what the
// /api/ingest/oms-ship-confirm endpoint and the refactored
// pushShipService.js already do — change_history audit row, BOL/PRO
// mirror back to OMS, SHIPMENT_UPDATED bus event for live UI refresh.
// CLAUDE_RULES §4: thin dispatcher, business logic stays in shipConfirm.
// ═══════════════════════════════════════════════════════════════════

const shipConfirm = require('../shipConfirm');

/**
 * Translate the queue payload (built by the OMS UI in zoree-oms.html)
 * into the body shape applyShipConfirm expects. Field names diverge
 * because the OMS side uses tmsShipmentId / shippedAt while the API
 * surface uses shipmentId / shippedAt.
 *
 * @param {object} payload — { tmsShipmentId, shippedAt?, sealNumber?, omsOrderId?, orderIds? }
 */
async function handlePushShip(payload) {
  if (!payload || !payload.tmsShipmentId) {
    throw new Error('PUSH_SHIP_STATUS payload missing tmsShipmentId');
  }
  const orderIds = Array.isArray(payload.orderIds) && payload.orderIds.length
    ? payload.orderIds
    : (payload.omsOrderId ? [payload.omsOrderId] : []);

  return shipConfirm.applyShipConfirm({
    shipmentId: payload.tmsShipmentId,
    orderIds,
    shippedAt:  payload.shippedAt || null,
    sealNumber: payload.sealNumber || null,
    source:     'oms-wms',
  });
}

module.exports = { handlePushShip };
