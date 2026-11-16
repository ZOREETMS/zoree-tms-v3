// AP inbox folder for the active domain: what is waiting, and the run in flight.
import { useCallback, useEffect, useRef, useState } from "react";
import { getInbox, startInboxRun } from "../services/invoiceIntakeService";

const POLL_MS = 1000;

export function useInvoiceInbox() {
  const [inbox, setInbox] = useState(null);
  const [error, setError] = useState("");
  const timer = useRef(null);

  const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };

  const refresh = useCallback(async () => {
    try {
      const data = await getInbox();
      setInbox(data);
      setError("");
      if (!data.job || data.job.status !== "running") stop();
      return data;
    } catch (e) {
      setError(e?.message || "Could not read the inbox");
      stop();
      return null;
    }
  }, []);

  const start = useCallback(async () => {
    try {
      await startInboxRun();
      setError("");
      await refresh();
      stop();
      timer.current = setInterval(refresh, POLL_MS);
    } catch (e) {
      setError(e?.message || "Could not start");
    }
  }, [refresh]);

  useEffect(() => stop, []);

  const job = inbox?.job || null;
  return { inbox, job, running: job?.status === "running", error, refresh, start };
}
