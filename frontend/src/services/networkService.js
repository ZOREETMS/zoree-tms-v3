import { OPPORTUNITY_LEVELS, UTILIZATION_THRESHOLDS, VARIANCE_THRESHOLDS } from "../types/network";

/**
 * Seed lane data for network modeling.
 */
export const SEED_LANES = [
  { lane: "CHI → DAL", loads: 42, avgCostMi: 2.18, benchmark: 2.05, util: 87, opportunity: "Medium" },
  { lane: "CMH → ATL", loads: 28, avgCostMi: 1.95, benchmark: 1.90, util: 72, opportunity: "Low" },
  { lane: "LAX → SEA", loads: 35, avgCostMi: 2.42, benchmark: 2.10, util: 91, opportunity: "High" },
  { lane: "NYC → CHI", loads: 51, avgCostMi: 1.88, benchmark: 1.85, util: 94, opportunity: "Low" },
  { lane: "HOU → MIA", loads: 19, avgCostMi: 2.65, benchmark: 2.30, util: 54, opportunity: "High" },
  { lane: "ATL → CMH", loads: 22, avgCostMi: 2.01, benchmark: 1.90, util: 68, opportunity: "Medium" },
  { lane: "DAL → CHI", loads: 38, avgCostMi: 2.12, benchmark: 2.05, util: 83, opportunity: "Low" },
  { lane: "SEA → LAX", loads: 30, avgCostMi: 2.38, benchmark: 2.10, util: 78, opportunity: "Medium" },
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
 * Run what-if scenario analysis.
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
export function getOpportunityStyle(level) {
  const config = OPPORTUNITY_LEVELS[level];
  if (config) return { color: config.color, background: config.bg };
  return { color: "#64748b", background: "#f8fafc" };
}
