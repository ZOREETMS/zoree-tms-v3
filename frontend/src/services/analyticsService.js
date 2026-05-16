import { TRANSPORT_MODES, getCarrierGrade } from "../types/analytics";

/**
 * QA #329 — analytics KPIs are advertised on web as "Total Shipments
 * (30d)" / "Cost per Shipment" (see AnalyticsStats.jsx:12), but the
 * underlying computeKpis used to reduce over the entire shipments
 * array regardless of date. Mobile inherited the same reducer and
 * showed a different headline number because the labels there said
 * "Total Shipments" with no time qualifier — testers read the gap as
 * "mobile is wrong" when in fact both surfaces were summarising every
 * shipment ever loaded.
 *
 * Honest fix: respect the documented window. ANALYTICS_WINDOW_DAYS is
 * exported so callers (and the synced mobile copy) read from one
 * source. A shipment is in-window if its created_at / pickup_date /
 * updated_at fall within the last N days; rows with no usable
 * timestamp are dropped so a future migration with non-date created_at
 * doesn't silently zero the KPIs.
 */
export const ANALYTICS_WINDOW_DAYS = 30;

function shipmentDateMs(s) {
  const raw =
    s?.created_at || s?.createdAt ||
    s?.pickup_date || s?.pickupDate ||
    s?.updated_at || s?.updatedAt;
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : null;
}

function filterToWindow(shipments, days = ANALYTICS_WINDOW_DAYS) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return (shipments || []).filter((s) => {
    const t = shipmentDateMs(s);
    return t !== null && t >= cutoff;
  });
}

export function computeKpis(shipments) {
  const windowed = filterToWindow(shipments);
  const total = windowed.length;
  const delivered = windowed.filter((s) => s.status === "Delivered").length;
  const onTimePct = total > 0 ? ((delivered / total) * 100).toFixed(1) : "0.0";
  const totalSpend = windowed.reduce(
    (sum, s) => sum + (parseFloat(s.total_cost) || 0),
    0
  );
  const costPerShipment = total > 0 ? Math.round(totalSpend / total) : 0;

  return {
    totalShipments: total,
    onTimePct,
    totalSpend,
    costPerShipment,
    windowDays: ANALYTICS_WINDOW_DAYS,
  };
}

/**
 * QA P217 (2026-05-11): single source of truth for Dashboard counts
 * shared with mobile. Synced copies live in
 *   shared/src/services/analyticsService.js
 *   mobile/src/shared/services/analyticsService.js
 * Keep all three in lockstep until the repo finishes consolidating
 * onto a single shared module.
 *
 * Web DashboardPage previously derived these inline; mobile derived
 * them via the older computeKpis() with different rounding — both
 * surfaces now call this so the numbers match.
 */
export function computeDashboardStats(shipments, orders) {
  const ships = Array.isArray(shipments) ? shipments : [];
  const ords = Array.isArray(orders) ? orders : [];

  const inTransit = ships.filter((s) => s.status === "In Transit").length;
  const planned = ships.filter((s) => s.status === "Planned").length;
  const tendered = ships.filter((s) => s.status === "Tendered").length;
  const delivered = ships.filter((s) => s.status === "Delivered").length;
  const exceptions = ships.filter((s) => s.status === "Exception").length;
  const unplanned = ords.filter((o) => o.status === "Unplanned").length;

  const totalCost = ships.reduce(
    (acc, sh) => acc + (parseFloat(sh.total_cost) || 0),
    0
  );

  const onTimePct =
    ships.length > 0 ? Math.round((delivered / ships.length) * 100) : 0;
  const onTimePctText =
    ships.length > 0 ? ((delivered / ships.length) * 100).toFixed(1) : "0.0";

  return {
    totalShipments: ships.length,
    totalOrders: ords.length,
    inTransit,
    planned,
    tendered,
    delivered,
    exceptions,
    unplanned,
    totalCost,
    onTimePct,
    onTimePctText,
  };
}

export function computeSpendByMode(shipments) {
  const totalSpend = shipments.reduce(
    (sum, s) => sum + (parseFloat(s.total_cost) || 0),
    0
  );

  if (totalSpend === 0) {
    return TRANSPORT_MODES.map((m) => ({
      ...m,
      amount: 0,
      pct: 0,
    }));
  }

  const modeMap = {};
  shipments.forEach((s) => {
    const mode = normalizeMode(s.mode || s.transport_mode || "TL");
    modeMap[mode] = (modeMap[mode] || 0) + (parseFloat(s.total_cost) || 0);
  });

  return TRANSPORT_MODES.map((m) => {
    const amount = modeMap[m.key] || 0;
    return {
      ...m,
      amount,
      pct: totalSpend > 0 ? Math.round((amount / totalSpend) * 100) : 0,
    };
  });
}

export function computeCarrierScorecard(carriers) {
  return carriers.slice(0, 8).map((c) => {
    const otd = parseFloat(c.otd) || parseFloat(c.on_time_pct) || 0;
    const claims = parseFloat(c.claimRatio) || parseFloat(c.claim_ratio) || parseFloat(c.claim) || 0;
    const grade = getCarrierGrade(otd);
    return {
      name: c.name,
      otd,
      claims,
      grade,
    };
  });
}

function normalizeMode(raw) {
  const val = String(raw).toUpperCase().trim();
  if (val.includes("TRUCK") || val === "TL" || val === "FTL") return "TL";
  if (val === "LTL" || val.includes("LESS")) return "LTL";
  if (val.includes("RAIL") || val.includes("INTER")) return "RAIL";
  if (val.includes("AIR")) return "AIR";
  if (val.includes("PARCEL") || val.includes("SMALL")) return "PARCEL";
  return "TL";
}
