// ---------------------------------------------------------------------------
// frontend/src/utils/omsSyncStatus.js
// Pure derivation of a shipment's OMS-sync status from its linked oms_orders
// rows. No IO, no React — unit-testable with fixtures.
//
// Column contract (migration 023):
//   oms_orders.tms_ship_status_pushed_at  TIMESTAMPTZ NULL
//     - stamped by api/services/omsSync.syncTenderAcceptToOms (inline path)
//       and by frontend/services/omsSync/pushShipService.stampShipStatusPushed
//       (middleware path) when a shipment status has been forwarded to TMS.
//
// Status semantics (for UI pill):
//   synced  — all linked oms_orders have tms_ship_status_pushed_at set
//   pending — ≥1 linked oms_orders has it NULL AND tender is recent
//   failed  — ≥1 linked oms_orders has it NULL AND tender is older than the
//             stale threshold (middleware should have caught up by now)
//   na      — no linked oms_orders (TMS-origin shipment, or not tendered yet)
// ---------------------------------------------------------------------------

export const OMS_SYNC_STALE_AFTER_MS = 5 * 60 * 1000; // 5 minutes

// Shipment statuses that are *past* the tender-accept boundary — these are
// the ones where we expect the OMS mirror to be populated. If the shipment
// is still Planned / Rated / Tender Rejected, no sync is expected and we
// render "na" regardless of linked oms_orders state.
const POST_TENDER_STATUSES = new Set([
  'Tendered', 'Tender Accepted', 'Confirmed', 'In Transit', 'Delivered',
]);

function parseMsOrNull(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * Derive the OMS-sync status pill for a single shipment.
 *
 * @param {Array<Object>} linkedOmsOrders - oms_orders rows where
 *        tms_shipment_id === shipment.id. Empty array if none.
 * @param {Object} shipment - The TMS shipment row (needs .status, optional
 *        .pickup_date or tendered_at metadata).
 * @param {Object} [opts]
 * @param {number} [opts.nowMs=Date.now()]
 * @param {number} [opts.staleAfterMs=OMS_SYNC_STALE_AFTER_MS]
 * @returns {{status: 'synced'|'pending'|'failed'|'na', label: string, color: string, title: string}}
 */
export function deriveOmsSyncStatus(linkedOmsOrders, shipment, opts = {}) {
  const nowMs        = opts.nowMs        || Date.now();
  const staleAfterMs = opts.staleAfterMs || OMS_SYNC_STALE_AFTER_MS;

  const hasLinks = Array.isArray(linkedOmsOrders) && linkedOmsOrders.length > 0;
  const isPostTender = POST_TENDER_STATUSES.has(shipment?.status);

  if (!hasLinks) {
    return {
      status: 'na',
      label:  '—',
      color:  'gray',
      title:  isPostTender
        ? 'No linked OMS order — shipment originated in TMS (no sync required).'
        : 'No OMS sync — shipment not yet tendered.',
    };
  }

  const pendingRows = linkedOmsOrders.filter(r => !r.tms_ship_status_pushed_at);

  if (pendingRows.length === 0) {
    return {
      status: 'synced',
      label:  'OMS ✓',
      color:  'green',
      title:  `${linkedOmsOrders.length} linked OMS order(s) mirrored. All in sync.`,
    };
  }

  // Some rows still pending. Decide pending-vs-failed by oldest tendered time.
  // Prefer the shipment's own tendered_at if present; fall back to the newest
  // non-null pushed_at on linked rows (proxy for "last successful sync"); if
  // neither exists, use the shipment's pickup_date as a coarse lower bound.
  const tenderedMs =
       parseMsOrNull(shipment?.tendered_at)
    || linkedOmsOrders.reduce((acc, r) => {
         const t = parseMsOrNull(r.tendered_at) || parseMsOrNull(r.tms_order_pushed_at);
         return (t && (!acc || t > acc)) ? t : acc;
       }, null)
    || parseMsOrNull(shipment?.pickup_date);

  const ageMs = tenderedMs ? (nowMs - tenderedMs) : 0;
  const isStale = ageMs > staleAfterMs;

  if (isStale) {
    return {
      status: 'failed',
      label:  'OMS ⚠',
      color:  'red',
      title:  `${pendingRows.length} of ${linkedOmsOrders.length} linked OMS order(s) NOT synced after ${Math.round(ageMs / 60000)} min. Middleware may be stuck — check server logs and migration 023.`,
    };
  }

  return {
    status: 'pending',
    label:  'OMS …',
    color:  'purple',
    title:  `${pendingRows.length} of ${linkedOmsOrders.length} linked OMS order(s) sync in progress. Middleware next tick.`,
  };
}
