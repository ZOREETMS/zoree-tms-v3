import { normalizeLane } from "../utils/laneUtils";

function isToday(value) {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

export function avgSavingsPerRun({ schedSaved = 0, schedRuns = 0 }) {
  if (!schedRuns) return 0;
  return Math.round(schedSaved / schedRuns);
}

export function consolidatedToday(orders = []) {
  return orders.filter((o) => o?.status === "Consolidated" && (
    isToday(o.updated_at) || isToday(o.planned_at) || isToday(o.created_at)
  )).length;
}

export function bestConsolidationLane(orders = []) {
  const byLane = new Map();
  for (const o of orders) {
    if (!o || o.status !== "Consolidated") continue;
    const key = `${normalizeLane(o.origin)}|${normalizeLane(o.dest)}`;
    if (!key || key === "|") continue;
    const cur = byLane.get(key) || { origin: o.origin, dest: o.dest, count: 0 };
    cur.count += 1;
    byLane.set(key, cur);
  }
  let best = null;
  for (const lane of byLane.values()) {
    if (!best || lane.count > best.count) best = lane;
  }
  return best;
}

export function avgUtilization(shipments = [], { capacityLbs = 45000 } = {}) {
  const active = shipments.filter((s) => {
    const st = String(s?.status || "").toLowerCase();
    return st && !["cancelled", "void"].includes(st);
  });
  if (active.length === 0) return 0;
  const total = active.reduce((sum, s) => {
    const w = Number(s?.total_weight ?? s?.weight ?? 0);
    return sum + Math.min(1, w > 0 ? w / capacityLbs : 0);
  }, 0);
  return Math.round((total / active.length) * 100);
}

export function aiRecommendation({ orders = [], shipments = [], schedRunning = false }) {
  const unplanned = orders.filter((o) => o?.status === "Unplanned").length;
  const util = avgUtilization(shipments);

  if (unplanned >= 10 && !schedRunning) {
    return { tone: "warn", label: "Start scheduler", reason: `${unplanned} unplanned orders waiting` };
  }
  if (util > 0 && util < 60) {
    return { tone: "info", label: "Consolidate further", reason: `Avg utilization only ${util}%` };
  }
  if (unplanned === 0 && shipments.length > 0) {
    return { tone: "good", label: "All planned", reason: "No unplanned orders" };
  }
  return { tone: "info", label: "Steady state", reason: "Operating normally" };
}

export function buildSchedulerMetrics({
  orders = [],
  shipments = [],
  schedRuns = 0,
  schedSaved = 0,
  schedRunning = false,
}) {
  return {
    avgSavings: avgSavingsPerRun({ schedSaved, schedRuns }),
    consolidatedToday: consolidatedToday(orders),
    bestLane: bestConsolidationLane(orders),
    avgUtilization: avgUtilization(shipments),
    recommendation: aiRecommendation({ orders, shipments, schedRunning }),
  };
}
