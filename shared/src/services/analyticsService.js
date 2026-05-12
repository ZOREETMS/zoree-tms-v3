import { TRANSPORT_MODES, getCarrierGrade } from "../types/analytics";

export function computeKpis(shipments) {
  const total = shipments.length;
  const delivered = shipments.filter((s) => s.status === "Delivered").length;
  const onTimePct = total > 0 ? ((delivered / total) * 100).toFixed(1) : "0.0";
  const totalSpend = shipments.reduce(
    (sum, s) => sum + (parseFloat(s.total_cost) || 0),
    0
  );
  const costPerShipment = total > 0 ? Math.round(totalSpend / total) : 0;

  return {
    totalShipments: total,
    onTimePct,
    totalSpend,
    costPerShipment,
  };
}

/**
 * QA P217 (2026-05-11): single source of truth for the Dashboard
 * status / cost / unplanned counts shared between web (DashboardPage)
 * and mobile (DashboardScreen). Previously each screen derived these
 * inline with subtly different logic — web rounded onTimePct to an
 * integer and counted exactly "In Transit"; mobile used a separate
 * computeKpis() that produced a string-formatted onTimePct and
 * additionally counted "Picked Up" shipments as active. That drift is
 * exactly what the QA report flagged as "Mobile and Web dashboard
 * data does not match".
 *
 * Returns a single shape both surfaces can read. Both client surfaces
 * still rely on their (paginated) data.shipments / data.orders, so
 * the absolute numbers are bounded by the 500-row page limit — but at
 * least they now agree.
 */
export function computeDashboardStats(shipments, orders) {
  const ships = Array.isArray(shipments) ? shipments : [];
  const ords = Array.isArray(orders) ? orders : [];

  // Status buckets — kept as exact case-sensitive equality so a future
  // status-rename in one platform is caught loudly (instead of silently
  // halving a count via a fold-case mismatch).
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

  // onTimePct is the delivered-share of all loaded shipments. Both web
  // and mobile previously diverged on rounding — web used Math.round
  // (integer), mobile used .toFixed(1) (string). This function returns
  // both so each surface picks the format it wants without recomputing.
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
