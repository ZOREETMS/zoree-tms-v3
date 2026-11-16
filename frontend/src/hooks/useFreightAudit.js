// Freight Audit queue — the active domain's invoices, read from the API.
// Every action is saved through the invoice endpoints (no local-only state).
import { useState, useMemo, useCallback, useEffect } from "react";
import { AUDIT_STATUS, PAY_STATUS } from "../types/freightAudit";
import {
  computeAuditKpis, loadAuditRecords, approveRecord, disputeRecord, releaseRecord, runAutoAudit,
} from "../services/freightAuditService";

export function useFreightAudit() {
  const [records, setRecords] = useState([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true); setError("");
    try { setRecords(await loadAuditRecords()); }
    catch (e) { setRecords([]); setError(e?.message || "Could not load invoices"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const filtered = useMemo(() => {
    if (!filter) return records;
    return records.filter((r) => r.auditStatus === filter || r.payStatus === filter);
  }, [records, filter]);

  const kpis = useMemo(() => computeAuditKpis(records), [records]);

  // Run one saved action on a record and swap in the row the server returned.
  const act = useCallback(async (id, action) => {
    const record = records.find((r) => r.id === id);
    if (!record) return { ok: false, toast: { text: "Invoice not found", type: "warning" } };
    setBusy(true);
    try {
      const out = await action(record);
      if (out.ok) setRecords((prev) => prev.map((r) => (r.id === id ? out.record : r)));
      return out;
    } finally { setBusy(false); }
  }, [records]);

  const approveInvoice = useCallback((id) => act(id, approveRecord), [act]);
  const disputeInvoice = useCallback((id) => act(id, disputeRecord), [act]);
  const releaseHold = useCallback((id) => act(id, releaseRecord), [act]);

  const approveAllClean = useCallback(async () => {
    const clean = records.filter((r) => r.auditStatus === AUDIT_STATUS.MATCHED && r.payStatus === PAY_STATUS.PENDING);
    let approved = 0;
    setBusy(true);
    try {
      for (const r of clean) { // one at a time: each approval writes history
        const out = await approveRecord(r); // eslint-disable-line no-await-in-loop
        if (out.ok) approved += 1;
      }
    } finally { setBusy(false); }
    await reload();
    return { approved, total: clean.length };
  }, [records, reload]);

  const runAudit = useCallback(async () => {
    setBusy(true);
    try { const summary = await runAutoAudit(); await reload(); return { ok: true, summary }; }
    catch (e) { return { ok: false, summary: e?.message || "Audit failed" }; }
    finally { setBusy(false); }
  }, [reload]);

  return {
    records, filtered, filter, setFilter, kpis, loading, error, busy, reload,
    approveInvoice, disputeInvoice, releaseHold, approveAllClean, runAudit,
  };
}
