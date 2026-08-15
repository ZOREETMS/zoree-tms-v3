// ═══════════════════════════════════════════════════════════════════
// Distance-based transit-day estimate — last-resort fallback for
// quotes whose carrier returns no live transit (SMC3 CarrierConnect
// unlicensed SCACs on the trial account) and whose rates-table row has
// no transit_days either (most LTL rows: verified 2026-08-09, nearly
// all rates.transit_days are NULL for LTL).
//
// Chain (applied in /api/bulk-plan/rate): CCXL live → rates.transit_days
// → THIS ESTIMATE. Estimated values are flagged `transitEstimated` so
// every surface (web plan modal, Teams bot card) can label them (≈)
// rather than presenting a guess as carrier-confirmed service days.
//
// Model: standard service-day tables approximate linehaul progress per
// business day. LTL networks (hub-and-spoke, terminal dwell) cover
// ~450 road miles/day; TL solo drivers ~550/day under HOS. Minimum 1
// day, capped at 10 (transcontinental worst case). Round UP — a
// 470-mile LTL lane is a 2-day lane, not 1.
//
// Pure module, no I/O — trivially unit-testable.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const MILES_PER_DAY = { LTL: 450, TL: 550 };
const MAX_DAYS = 10;

/**
 * @param {object} args
 * @param {number} args.miles - road miles for the lane (PC*MILER, rate
 *                              row, or haversine — caller's best number)
 * @param {string} [args.mode] - 'LTL' | 'TL' (default LTL, the slower net)
 * @returns {number|null} whole transit days, or null when miles unknown
 */
function estimateTransitDays({ miles, mode } = {}) {
  const mi = Number(miles);
  if (!mi || mi <= 0) return null;
  const perDay = MILES_PER_DAY[String(mode || 'LTL').toUpperCase()] || MILES_PER_DAY.LTL;
  return Math.min(MAX_DAYS, Math.max(1, Math.ceil(mi / perDay)));
}

module.exports = { estimateTransitDays, MILES_PER_DAY, MAX_DAYS };
