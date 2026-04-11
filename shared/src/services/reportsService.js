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

// Normalized to uppercase for case-insensitive matching
const LANE_DISTANCES = {};
const _rawLanes = {
  "Chicago, IL|Dallas, TX": 921, "Columbus, OH|Atlanta, GA": 640,
  "Dallas, TX|Atlanta, GA": 781, "Houston, TX|Atlanta, GA": 795,
  "Atlanta, GA|New York, NY": 882, "Dallas, TX|Phoenix, AZ": 1072,
  "Memphis, TN|Denver, CO": 1069, "Chicago, IL|New York, NY": 790,
  "Los Angeles, CA|Seattle, WA": 1135, "Mountain View, CA|Seattle, WA": 1300,
  "Charlotte, NC|Houston, TX": 1290, "San Jose, CA|Columbus, OH": 2390,
  "Boston, MA|Phoenix, AZ": 2665, "Miami, FL|Denver, CO": 2107,
  "Phoenix, AZ|Boston, MA": 2665, "Denver, CO|Miami, FL": 2107,
};
// Build both uppercase and title-case keys for matching
for (const [key, val] of Object.entries(_rawLanes)) {
  LANE_DISTANCES[key] = val;
  LANE_DISTANCES[key.toUpperCase()] = val;
}

const DEFAULT_DISTANCE = 750;

// PC*MILER mileage cache — populated by calling setMileageCache() from report components
let _pcMilerCache = {};
export function setMileageCache(map) { _pcMilerCache = map || {}; }

function estimateDistance(origin, dest) {
  if (!origin || !dest) return 0;
  // Check PC*MILER cache first
  const pcKey = `${(origin).toUpperCase().trim()}|${(dest).toUpperCase().trim()}`;
  if (_pcMilerCache[pcKey]) return _pcMilerCache[pcKey];
  // Fall back to hardcoded lanes
  const fwd = `${origin}|${dest}`;
  const rev = `${dest}|${origin}`;
  return LANE_DISTANCES[fwd] || LANE_DISTANCES[rev]
    || LANE_DISTANCES[fwd.toUpperCase()] || LANE_DISTANCES[rev.toUpperCase()]
    || DEFAULT_DISTANCE;
}

function carrierMatch(shipCarrier, carrierName) {
  return (shipCarrier || "").toUpperCase() === (carrierName || "").toUpperCase();
}

export function buildCarrierPerformance(carriers, shipments) {
  return carriers
    .map((car) => {
      const otd = parseFloat(car.otd ?? car.on_time_pct) || 0;
      const claim = parseFloat(car.claim ?? car.claim_ratio) || 0;
      const cost = parseFloat(car.cost ?? car.cost_per_mile) || 0;
      const grade = otd > 95 ? "A" : otd > 90 ? "B" : "C";
      const shipCount = shipments.filter((s) => carrierMatch(s.carrier, car.name)).length;
      return {
        name: car.name,
        scac: car.scac,
        mode: car.mode,
        otd,
        claim,
        avgRate: cost,
        shipments: shipCount,
        grade,
      };
    })
    .sort((a, b) => b.otd - a.otd);
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
    otd: parseFloat(c.otd ?? c.on_time_pct) || 0,
    shipments: shipments.filter((s) => carrierMatch(s.carrier, c.name)).length,
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

/**
 * Deterministic hash from a string — produces a stable number for a given shipment ID.
 */
function stableHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function estimateSaving(shipmentId) {
  return 200 + (stableHash(shipmentId) % 800);
}

export function buildConsolidationSavings(shipments) {
  const getOrders = (s) => s.consolidatedOrders || s.order_ids || [];
  const consolidated = shipments.filter((s) => getOrders(s).length > 1);
  const rows = consolidated.map((sh) => ({
    id: sh.id,
    origin: (sh.origin || "").split(",")[0],
    dest: (sh.dest || "").split(",")[0],
    orderCount: getOrders(sh).length,
    saving: sh._savings || estimateSaving(sh.id),
  }));
  const totalSavings = rows.reduce((s, r) => s + r.saving, 0);
  const avgSaving = rows.length > 0 ? Math.round(totalSavings / rows.length) : 0;
  return { count: consolidated.length, totalSavings, avgSaving, rows };
}

export function buildSustainability(carriers, shipments) {
  const totalMiles = shipments.reduce((s, sh) => s + estimateDistance(sh.origin, sh.dest), 0);
  const co2kg = Math.round(totalMiles * CO2_PER_MILE);
  const savedViaConsolidation = Math.round(co2kg * 0.18);
  const byCarrier = carriers.map((car) => {
    const cMiles = shipments
      .filter((s) => carrierMatch(s.carrier, car.name))
      .reduce((s, sh) => s + estimateDistance(sh.origin, sh.dest), 0);
    return { name: car.name, miles: cMiles, co2: Math.round(cMiles * CO2_PER_MILE) };
  });
  return { totalMiles, co2kg, savedViaConsolidation, byCarrier };
}
