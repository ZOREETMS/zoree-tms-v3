// AP release queue for the active domain: awaiting release, released,
// exported and blocked invoices. Reloads when `refreshKey` changes.
import { useCallback, useEffect, useState } from "react";
import { getQueue } from "../services/apReleaseService";

export function useApReleaseQueue(refreshKey) {
  const [queue, setQueue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      setQueue(await getQueue());
      setError("");
    } catch (e) {
      setError(e?.message || "Could not load the release queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload, refreshKey]);

  return { queue, loading, error, reload };
}
