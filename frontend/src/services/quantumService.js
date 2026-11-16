/**
 * Quantum Service — frontend/src/services/quantumService.js
 * ──────────────────────────────────────────────────────────
 * UI-facing wrapper over QuantumApi (CLAUDE_RULES §2: components never
 * call the API directly). The server does all mapping, preflight and
 * capacity re-validation; this layer only shapes results for display.
 *
 * Volume: Zoree orders carry no volume today, so planning needs a
 * density assumption. 12 lb/cu ft matches a 53' dry van (45,000 lb /
 * 3,800 cu ft). Every order planned on an estimate is listed in
 * summary.volume_estimated_ids — show that to the planner.
 */

import { QuantumApi } from "../lib/api";

export const DEFAULT_DENSITY_LB_PER_CUFT = 12;

/**
 * Engines the server can plan with. "zoree" is Zoree's own QUBO optimizer
 * (default, in-process); "otodus" is the vendor container. Omit `engine`
 * to use the server default (QUANTUM_ENGINE_MODE).
 */
export const ENGINES = Object.freeze({ ZOREE: "zoree", OTODUS: "otodus" });

/** { reachable, configured, health?, error?, engine, engines: { zoree?, otodus? } } */
export function getEngineStatus() {
  return QuantumApi.status();
}

/**
 * Consolidate orders into truckloads. Pass orderIds for a selection, or
 * omit them to use unplanned orders (server default limit 200).
 */
export function planConsolidation({ orderIds, limit, densityLbPerCuft = DEFAULT_DENSITY_LB_PER_CUFT, dryRun = false, engine, seed } = {}) {
  return QuantumApi.planConsolidate({ orderIds, limit, densityLbPerCuft, dryRun, engine, seed });
}

/** Carrier assignment for a set of orders (single-order planning uses this). */
export function planRates({ orderIds, limit, densityLbPerCuft = DEFAULT_DENSITY_LB_PER_CUFT, dryRun = false, engine } = {}) {
  return QuantumApi.planRates({ orderIds, limit, densityLbPerCuft, dryRun, engine });
}

/**
 * Flatten a plan result into display rows. Only `feasible` groups are
 * actionable; infeasible ones broke a capacity cap the engine ignored.
 */
export function summarizeConsolidation(result) {
  if (!result || result.status !== "ok" || !result.validated) return null;
  const t = result.totals || {};
  return {
    groupsReturned: t.groups_returned || 0,
    groupsFeasible: t.groups_feasible || 0,
    groupsInfeasible: t.groups_infeasible || 0,
    bankableSavings: Number(t.feasible_savings) || 0,
    engineClaimedSavings: Number(t.claimed_savings) || 0,
    estimatedVolumeCount: (result.summary?.volume_estimated_ids || []).length,
    excludedCount: result.summary?.preflight?.excluded || 0,
    skippedCount: result.summary?.shipments?.skipped || 0,
    engine: result.engine || null,
    // Zoree engine only: the classical greedy plan it was measured against.
    greedySavings: result.benchmark ? Number(result.benchmark.greedy_savings) || 0 : null,
    quboSavings: result.benchmark ? Number(result.benchmark.qubo_savings) || 0 : null,
    unconsolidatedCount: (result.unconsolidated || []).length,
  };
}
