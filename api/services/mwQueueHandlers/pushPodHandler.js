// ═══════════════════════════════════════════════════════════════════
// MW Queue Handler — PUSH_POD_STATUS
//
// Handler for the OMS-queued POD / Delivered command. Delegates to the
// shipmentEvents service so this path matches /api/ingest/oms-pod and
// the refactored pushPodService.js — change_history audit row,
// delivery_date + delivered_at stamped, syncDeliveredToOms (skipped
// because source is 'oms-wms', preventing round-trip), SHIPMENT_UPDATED
// bus event. CLAUDE_RULES §4: thin dispatcher only.
// ═══════════════════════════════════════════════════════════════════

const shipmentEvents = require('../shipmentEvents');

/**
 * @param {object} payload — { tmsShipmentId, deliveredAt?, podReceivedBy?,
 *                              podCondition?, podNotes? }
 */
async function handlePushPod(payload) {
  if (!payload || !payload.tmsShipmentId) {
    throw new Error('PUSH_POD_STATUS payload missing tmsShipmentId');
  }
  // Compose the planner-facing note out of the discrete POD fields the
  // warehouse captured. Mirrors the formatting used by pushPodService.js
  // so the change_history note column reads identically across all paths.
  const noteParts = [];
  if (payload.podReceivedBy) noteParts.push('POD by: ' + payload.podReceivedBy);
  if (payload.podCondition)  noteParts.push('Condition: ' + payload.podCondition);
  if (payload.podNotes)      noteParts.push(String(payload.podNotes));

  return shipmentEvents.applyShipmentEvent({
    shipmentId: payload.tmsShipmentId,
    type:       'Delivered',
    date:       payload.deliveredAt
                  ? String(payload.deliveredAt).slice(0, 10)
                  : undefined,
    note:       noteParts.length ? noteParts.join(' · ') : null,
    user:       { email: 'oms-wms' },
  });
}

module.exports = { handlePushPod };
