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
    const otd = parseFloat(c.otd) || 0;
    const claims = parseFloat(c.claim) || 0;
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
