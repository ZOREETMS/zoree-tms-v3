// NetSuite export batches (with their invoices) for the active domain.
import { useCallback, useEffect, useState } from "react";
import { getExports } from "../services/apReleaseService";

export function useApExports(refreshKey) {
  const [data, setData] = useState({ batches: [], missingConfig: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const out = await getExports();
      setData({ batches: out?.batches || [], missingConfig: out?.missingConfig || [] });
      setError("");
    } catch (e) {
      setError(e?.message || "Could not load export batches");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload, refreshKey]);

  return { ...data, loading, error, reload };
}
