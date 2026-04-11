import { useMemo } from "react";
import {
  computeKpis,
  computeSpendByMode,
  computeCarrierScorecard,
} from "../services/analyticsService";

export function useAnalytics(shipments, carriers) {
  const kpis = useMemo(() => computeKpis(shipments), [shipments]);

  const spendByMode = useMemo(
    () => computeSpendByMode(shipments),
    [shipments]
  );

  const carrierScorecard = useMemo(
    () => computeCarrierScorecard(carriers),
    [carriers]
  );

  return { kpis, spendByMode, carrierScorecard };
}
