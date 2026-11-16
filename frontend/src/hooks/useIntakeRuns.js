// Agent run log for the active domain (migration 056): scheduled mailbox
// checks and "Read AP Mailbox" presses. Reloads when `refreshKey` changes,
// and every 30 seconds while the tab is open so a timer run shows up.
import { useCallback, useEffect, useState } from "react";
import { getIntakeRuns, getIntakeRun } from "../services/invoiceIntakeService";

const REFRESH_MS = 30000;

export function useIntakeRuns(refreshKey) {
  const [data, setData] = useState({ runs: [], schedule: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const out = await getIntakeRuns();
      setData({ runs: out?.runs || [], schedule: out?.schedule || null });
      setError("");
    } catch (e) {
      setError(e?.message || "Could not load the agent run log");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload, refreshKey]);
  useEffect(() => {
    const t = setInterval(reload, REFRESH_MS);
    return () => clearInterval(t);
  }, [reload]);

  return { runs: data.runs, schedule: data.schedule, loading, error, reload };
}

/** One run and the documents it read; null id → nothing loaded. */
export function useIntakeRun(runId) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!runId) { setDetail(null); return undefined; }
    let live = true;
    setLoading(true);
    getIntakeRun(runId)
      .then((d) => { if (live) { setDetail(d); setError(""); } })
      .catch((e) => { if (live) setError(e?.message || "Could not load the run"); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [runId]);

  return { detail, loading, error };
}
