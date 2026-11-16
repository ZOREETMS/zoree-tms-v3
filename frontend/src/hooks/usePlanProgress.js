// State for the "Planning in progress" dialog (PlanningProgressModal).
// Shared by OrdersPage (Plan Selected) and BulkPlanPage so both report
// the same stages from bulkPlanOrders' onProgress callback.
import { useCallback, useState } from "react";

export function usePlanProgress() {
  const [progress, setProgress] = useState(null);
  const start = useCallback(
    (orderCount) => setProgress({ orderCount, stage: "checking", startedAt: Date.now() }),
    []
  );
  // Stage updates are ignored once the dialog is closed.
  const onProgress = useCallback(
    (stage, info) => setProgress((p) => (p ? { ...p, ...info, stage } : p)),
    []
  );
  const clear = useCallback(() => setProgress(null), []);
  return { progress, start, onProgress, clear };
}
