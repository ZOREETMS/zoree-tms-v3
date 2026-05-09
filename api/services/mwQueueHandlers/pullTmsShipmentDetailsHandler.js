// ═══════════════════════════════════════════════════════════════════
// MW Queue Handler — PULL_TMS_SHIPMENT_DETAILS
//
// Backend port of the legacy browser MW case (zoree-middleware.html
// processMWQueue → 'PULL_TMS_SHIPMENT_DETAILS'). The OMS Edit-Order
// modal calls this to populate the "TMS PLAN — TENDER ACCEPTED"
// section with the shipment row that lives in the TMS `shipments`
// table. Read-only; returns the same { shipment } shape the OMS
// UI already expects (zoree-oms.html populateOmTmsPlan).
// ═══════════════════════════════════════════════════════════════════

const db = require('../supabase');

// Column names match the actual public.shipments schema. The loading
// window pair is `loading_start` / `loading_end` (added in migration
// 20260324120000_shipments_loading_times); there are no `dock_load_*`
// columns. Selecting those names makes Postgres reject the read with
// "column shipments.dock_load_start does not exist", which surfaces
// in the OMS Edit-Order modal as a red "Could not load TMS plan"
// banner. Use the canonical names everywhere else in the codebase
// already uses (api/services/shipments.js, omsSync.js).
const SHIPMENT_COLS = [
  'id', 'status', 'carrier', 'mode', 'service_level',
  'pickup_date', 'delivery_date',
  'dock_door', 'dock_time', 'loading_start', 'loading_end',
  'bol_number', 'pro_number', 'seal_number',
].join(',');

/**
 * @param {object} payload — { shipmentId }
 * @returns {Promise<{ shipment: object|null }>}
 */
async function handlePullTmsShipmentDetails(payload) {
  const sid = payload && payload.shipmentId ? String(payload.shipmentId) : '';
  if (!sid) throw new Error('PULL_TMS_SHIPMENT_DETAILS payload missing shipmentId');

  const rows = await db.dbSelect('shipments', {
    select:  SHIPMENT_COLS,
    filters: [['id', 'eq', sid]],
    limit:   1,
  });
  return { shipment: rows[0] || null };
}

module.exports = { handlePullTmsShipmentDetails };
