// Immutable AP audit ledger for one invoice or one export batch.
import { useEffect, useState } from "react";
import { getBatchHistory, getInvoiceHistory } from "../services/apReleaseService";

export function useApAuditHistory({ invoiceId = null, batchId = null, refreshKey = null }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!invoiceId && !batchId) return undefined;
    let gone = false;
    setLoading(true);
    (invoiceId ? getInvoiceHistory(invoiceId) : getBatchHistory(batchId))
      .then((rows) => { if (!gone) { setEvents(rows); setError(""); } })
      .catch((e) => { if (!gone) setError(e?.message || "Could not load the audit history"); })
      .finally(() => { if (!gone) setLoading(false); });
    return () => { gone = true; };
  }, [invoiceId, batchId, refreshKey]);

  return { events, loading, error };
}
