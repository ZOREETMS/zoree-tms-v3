import { useState, useMemo, useCallback } from "react";
import { SEED_LANES, computeNetworkKpis, runScenario } from "../services/networkService";

export function useNetwork() {
  const [lanes, setLanes] = useState(SEED_LANES);
  const [scenarioParams, setScenarioParams] = useState({ rateChange: 0, volumeChange: 0 });
  const [scenarioResult, setScenarioResult] = useState(null);

  const kpis = useMemo(() => computeNetworkKpis(lanes), [lanes]);

  const applyScenario = useCallback(() => {
    const result = runScenario(lanes, scenarioParams);
    setScenarioResult(result);
    return result;
  }, [lanes, scenarioParams]);

  const resetScenario = useCallback(() => {
    setScenarioParams({ rateChange: 0, volumeChange: 0 });
    setScenarioResult(null);
  }, []);

  const displayLanes = scenarioResult || lanes;

  return {
    lanes: displayLanes,
    baseLanes: lanes,
    kpis,
    scenarioParams,
    setScenarioParams,
    applyScenario,
    resetScenario,
    isScenarioActive: !!scenarioResult,
  };
}
