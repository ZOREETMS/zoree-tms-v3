// AP mailbox for the active domain: start a check and follow the invoices it reads.
import { useCallback, useEffect, useRef, useState } from "react";
import { getMailbox, startMailboxRun } from "../services/invoiceIntakeService";

const POLL_MS = 1500;
// Before the first click: show what was read in the last few minutes (a
// background check may have picked mail up). After a click: only what that
// check read, from the server's own start time — so a repeat click with no
// new mail says so instead of listing the last run again.
const LOOK_BACK_MS = 2 * 60 * 1000;

export function useInvoiceMailbox() {
  const [box, setBox] = useState(null);
  const [error, setError] = useState("");
  const [checked, setChecked] = useState(false);
  const since = useRef(new Date(Date.now() - LOOK_BACK_MS).toISOString());
  const timer = useRef(null);

  const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };

  const refresh = useCallback(async () => {
    try {
      const data = await getMailbox(since.current);
      setBox(data);
      setError("");
      if (!data.running) { stop(); setChecked(true); }
      return data;
    } catch (e) {
      setError(e?.message || "Could not read the mailbox");
      stop();
      return null;
    }
  }, []);

  const start = useCallback(async () => {
    try {
      setChecked(false);
      const started = await startMailboxRun();
      if (started?.startedAt) since.current = started.startedAt;
      setError("");
      stop();
      timer.current = setInterval(refresh, POLL_MS);
      await refresh();
    } catch (e) {
      setError(e?.message || "Could not start");
    }
  }, [refresh]);

  useEffect(() => stop, []);

  return { box, results: box?.results || [], running: Boolean(box?.running) || (!checked && !error && Boolean(timer.current)), checked, error, start };
}
