import { useState, useMemo, useCallback } from "react";
import { computeNetworkKpis, runLaneScenario } from "../services/networkService";

export function useNetwork() {
  const [lanes] = useState([]) /* no lane-analysis source in the API yet */;
  const [scenarioParams, setScenarioParams] = useState({ rateChange: -5, volumeChange: 10 });
  const [scenarioResult, setScenarioResult] = useState(null);

  const kpis = useMemo(() => computeNetworkKpis(lanes), [lanes]);

  const applyScenario = useCallback((laneName) => {
    const result = runLaneScenario(lanes, laneName, scenarioParams.rateChange, scenarioParams.volumeChange);
    setScenarioResult(result);
    return result;
  }, [lanes, scenarioParams]);

  const resetScenario = useCallback(() => {
    setScenarioParams({ rateChange: -5, volumeChange: 10 });
    setScenarioResult(null);
  }, []);

  return {
    lanes,
    kpis,
    scenarioParams,
    setScenarioParams,
    applyScenario,
    resetScenario,
    scenarioResult,
    isScenarioActive: !!scenarioResult,
  };
}
