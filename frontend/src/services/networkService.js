import { OPPORTUNITY_LEVELS, UTILIZATION_THRESHOLDS, VARIANCE_THRESHOLDS } from "../types/network";

/**
 * Seed lane data for network modeling.
 */
export const SEED_LANES = [
  { lane: "CHI → DAL", loads: 12, avgCostMi: 2.31, benchmark: 2.20, util: 78, opportunity: "Low — consider consolidation" },
  { lane: "CMH → ATL", loads: 8, avgCostMi: 2.18, benchmark: 2.25, util: 85, opportunity: "Optimized" },
  { lane: "LAX → SEA", loads: 5, avgCostMi: 2.58, benchmark: 2.40, util: 62, opportunity: "High — rebid lane" },
  { lane: "NYC → CHI", loads: 15, avgCostMi: 2.15, benchmark: 2.20, util: 91, opportunity: "Optimized" },
  { lane: "HOU → MIA", loads: 4, avgCostMi: 2.72, benchmark: 2.45, util: 55, opportunity: "High — rebid lane" },
  { lane: "ATL → CMH", loads: 9, avgCostMi: 2.22, benchmark: 2.25, util: 80, opportunity: "Optimized" },
  { lane: "DAL → CHI", loads: 7, avgCostMi: 2.44, benchmark: 2.35, util: 70, opportunity: "Medium — review rates" },
  { lane: "SEA → LAX", loads: 6, avgCostMi: 2.49, benchmark: 2.40, util: 68, opportunity: "Medium — review rates" },
];

/**
 * Compute network KPIs from lane data.
 */
export function computeNetworkKpis(lanes) {
  const active = lanes.length;
  const optimized = lanes.filter((l) => l.util >= UTILIZATION_THRESHOLDS.HIGH).length;
  const underUtilized = lanes.filter((l) => l.util < UTILIZATION_THRESHOLDS.MEDIUM).length;
  const totalSavings = lanes.reduce((sum, l) => {
    const diff = l.avgCostMi - l.benchmark;
    return sum + (diff > 0 ? diff * l.loads * 500 : 0); // estimated miles per load
  }, 0);

  return { active, optimized, underUtilized, savings: totalSavings };
}

/**
 * Run what-if scenario analysis on all lanes.
 */
export function runScenario(lanes, params) {
  const { rateChange = 0, volumeChange = 0 } = params;
  return lanes.map((lane) => ({
    ...lane,
    avgCostMi: +(lane.avgCostMi * (1 + rateChange / 100)).toFixed(2),
    loads: Math.round(lane.loads * (1 + volumeChange / 100)),
  }));
}

/**
 * Run what-if scenario on a single lane (matches old HTML runScenario).
 */
export function runLaneScenario(lanes, laneName, rateChange, volumeChange) {
  const lane = lanes.find((l) => l.lane === laneName);
  if (!lane) return null;
  const baseCost = lane.loads * lane.avgCostMi * 500;
  const newRate = lane.avgCostMi * (1 + rateChange / 100);
  const newLoads = lane.loads * (1 + volumeChange / 100);
  const newCost = newLoads * newRate * 500;
  const saving = baseCost - newCost;
  const sign = saving >= 0 ? "-" : "+";
  const savingStr = sign + "$" + Math.round(Math.abs(saving)).toLocaleString();
  const annualStr = sign + "$" + Math.round(Math.abs(saving) * 12).toLocaleString();
  return { newRate: newRate.toFixed(3), newLoads: Math.round(newLoads), saving, savingStr, annualStr };
}

/**
 * Get utilization bar color based on percentage.
 */
export function getUtilizationColor(util) {
  if (util >= UTILIZATION_THRESHOLDS.HIGH) return OPPORTUNITY_LEVELS.Low.color;
  if (util >= UTILIZATION_THRESHOLDS.MEDIUM) return OPPORTUNITY_LEVELS.Medium.color;
  return OPPORTUNITY_LEVELS.High.color;
}

/**
 * Get variance color based on cost vs benchmark.
 */
export function getVarianceColor(avgCost, benchmark) {
  const pct = ((avgCost - benchmark) / benchmark) * 100;
  if (pct > VARIANCE_THRESHOLDS.DANGER) return OPPORTUNITY_LEVELS.High.color;
  if (pct > VARIANCE_THRESHOLDS.WARNING) return OPPORTUNITY_LEVELS.Medium.color;
  return OPPORTUNITY_LEVELS.Low.color;
}

/**
 * Get opportunity badge style.
 */
export function getOpportunityStyle(opportunity) {
  if (opportunity.startsWith("High")) return { color: OPPORTUNITY_LEVELS.High.color };
  if (opportunity.startsWith("Medium")) return { color: OPPORTUNITY_LEVELS.Medium.color };
  if (opportunity.startsWith("Low")) return { color: OPPORTUNITY_LEVELS.Low?.color || "var(--green)" };
  return { color: "var(--green)" };
}
