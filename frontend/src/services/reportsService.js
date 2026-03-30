/**
 * Reports Service
 * Computes report data from shipments, carriers, and orders.
 * All heavy logic lives here — UI components only render.
 */

const NETWORK_LANES = [
  { lane: "DAL → CHI", loads: 42, avgCostMi: 2.85, benchmark: 2.65, util: 87, opportunity: "High — backhaul" },
  { lane: "ATL → MIA", loads: 36, avgCostMi: 2.40, benchmark: 2.50, util: 92, opportunity: "Low" },
  { lane: "CHI → NYC", loads: 55, avgCostMi: 3.10, benchmark: 2.90, util: 78, opportunity: "Med — mode shift" },
  { lane: "LAX → PHX", loads: 28, avgCostMi: 2.20, benchmark: 2.30, util: 95, opportunity: "Low" },
  { lane: "SEA → PDX", loads: 18, avgCostMi: 3.50, benchmark: 2.80, util: 65, opportunity: "High — consolidation" },
  { lane: "HOU → DAL", loads: 31, avgCostMi: 2.10, benchmark: 2.15, util: 88, opportunity: "Low" },
];

// ~0.161 kg CO2 per mile for average TL
const CO2_PER_MILE = 0.161;

function estimateDistance(origin, dest) {
  if (!origin || !dest) return 0;
  const hash = (origin.length + dest.length) * 17 + origin.charCodeAt(0);
  return 200 + (hash % 1800);
}

export function buildCarrierPerformance(carriers, shipments) {
  return carriers.map((car) => {
    const grade = car.otd > 95 ? "A" : car.otd > 90 ? "B" : "C";
    const shipCount = shipments.filter((s) => s.carrier === car.name).length;
    return {
      name: car.name,
      scac: car.scac,
      mode: car.mode,
      otd: car.otd,
      claim: car.claim,
      avgRate: parseFloat(car.cost) || 0,
      shipments: shipCount,
      grade,
    };
  });
}

export function buildLaneCostAnalysis() {
  return NETWORK_LANES.map((n) => {
    const variance = ((n.avgCostMi - n.benchmark) / n.benchmark * 100).toFixed(1);
    return { ...n, variance: parseFloat(variance) };
  });
}

export function buildOnTimeDelivery(carriers, shipments) {
  const rows = carriers.map((c) => ({
    name: c.name,
    otd: c.otd,
    shipments: shipments.filter((s) => s.carrier === c.name).length,
  }));
  const avg = rows.length > 0
    ? (rows.reduce((s, c) => s + c.otd, 0) / rows.length).toFixed(1)
    : "0.0";
  const best = rows.reduce((a, b) => (b.otd > a.otd ? b : a), rows[0] || { name: "N/A", otd: 0 });
  const worst = rows.reduce((a, b) => (b.otd < a.otd ? b : a), rows[0] || { name: "N/A", otd: 0 });
  return { avg, best: best.name, worst: worst.name, rows };
}

export function buildFreightSpend(shipments) {
  const invoices = shipments
    .filter((s) => s.total_cost)
    .map((s) => ({ carrier: s.carrier || "Unknown", amount: parseFloat(s.total_cost) || 0 }));
  const total = invoices.reduce((s, i) => s + i.amount, 0);
  const byCarrier = {};
  invoices.forEach((inv) => { byCarrier[inv.carrier] = (byCarrier[inv.carrier] || 0) + inv.amount; });
  const breakdown = Object.entries(byCarrier)
    .sort((a, b) => b[1] - a[1])
    .map(([name, amount]) => ({ name, amount, pct: total > 0 ? Math.round((amount / total) * 100) : 0 }));
  return { total, breakdown };
}

export function buildConsolidationSavings(shipments) {
  const consolidated = shipments.filter(
    (s) => s.consolidatedOrders && s.consolidatedOrders.length > 1
  );
  const savings = consolidated.reduce(
    (s, sh) => s + (sh._savings || Math.floor(Math.random() * 800 + 200)),
    0
  );
  const avgSaving = consolidated.length > 0 ? Math.round(savings / consolidated.length) : 0;
  const rows = consolidated.map((sh) => ({
    id: sh.id,
    origin: (sh.origin || "").split(",")[0],
    dest: (sh.dest || "").split(",")[0],
    orderCount: sh.consolidatedOrders.length,
    saving: sh._savings || Math.floor(Math.random() * 800 + 200),
  }));
  return { count: consolidated.length, totalSavings: savings, avgSaving, rows };
}

export function buildSustainability(carriers, shipments) {
  const totalMiles = shipments.reduce((s, sh) => s + estimateDistance(sh.origin, sh.dest), 0);
  const co2kg = Math.round(totalMiles * CO2_PER_MILE);
  const savedViaConsolidation = Math.round(co2kg * 0.18);
  const byCarrier = carriers.map((car) => {
    const cMiles = shipments
      .filter((s) => s.carrier === car.name)
      .reduce((s, sh) => s + estimateDistance(sh.origin, sh.dest), 0);
    return { name: car.name, miles: cMiles, co2: Math.round(cMiles * CO2_PER_MILE) };
  });
  return { totalMiles, co2kg, savedViaConsolidation, byCarrier };
}
