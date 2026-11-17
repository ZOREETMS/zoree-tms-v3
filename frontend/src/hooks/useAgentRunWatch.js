// Watches the agent run log while Freight Invoices is open. When the
// agent finishes a run on its own (a new email arrived, catch-up or
// backup check), `onFinished` reloads the lists, so invoices appear
// without a page refresh. While a run is going, `running` is that run.
import { useEffect, useRef, useState } from "react";
import { getIntakeRuns } from "../services/invoiceIntakeService";

const POLL_MS = 4000;

/** Pure: the run that changed since `prevKey`, or null. Exported for tests. */
// prevKey null = not looked yet; "none" = looked, no runs. A run that
// starts and finishes between two looks (timers slow down in a background
// tab) still counts as finished, because its key differs from the last one.
export function runChange(prevKey, latest) {
  const key = latest ? `${latest.id}:${latest.status}` : "none";
  if (prevKey === null) return { key, finished: false }; // first look: baseline only
  return { key, finished: key !== prevKey && Boolean(latest) && latest.status !== "running" };
}

export function useAgentRunWatch(onFinished) {
  const [running, setRunning] = useState(null);
  const keyRef = useRef(null);
  const cbRef = useRef(onFinished);
  cbRef.current = onFinished;

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const out = await getIntakeRuns(5);
        if (stop) return;
        const latest = (out?.runs || [])[0] || null;
        const ch = runChange(keyRef.current, latest);
        keyRef.current = ch.key;
        setRunning(latest && latest.status === "running" ? latest : null);
        if (ch.finished && cbRef.current) cbRef.current(latest);
      } catch { /* the next poll tries again */ }
    }
    poll();
    const t = setInterval(poll, POLL_MS);
    // Back on the tab: look right away rather than at the next tick.
    const onVisible = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => { stop = true; clearInterval(t); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); };
  }, []);

  return { running };
}
