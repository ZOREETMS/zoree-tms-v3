// Invoice intake log for the active domain. Reloads when `refreshKey` changes.
import { useCallback, useEffect, useState } from "react";
import { getIntakeLog } from "../services/invoiceIntakeService";

export function useInvoiceIntakeLog(refreshKey) {
  const [log, setLog] = useState({ entries: [], summary: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const data = await getIntakeLog();
      setLog({ entries: data?.entries || [], summary: data?.summary || null });
      setError("");
    } catch (e) {
      setError(e?.message || "Could not load the intake log");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload, refreshKey]);

  return { entries: log.entries, summary: log.summary, loading, error, reload };
}
