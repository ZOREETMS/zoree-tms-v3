import { useState, useMemo, useCallback } from "react";
import { AUDIT_STATUS, PAY_STATUS } from "../types/freightAudit";
import { computeAuditKpis } from "../services/freightAuditService";

export function useFreightAudit(initialRecords = []) {
  const [records, setRecords] = useState(initialRecords);
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    if (!filter) return records;
    return records.filter(
      (r) => r.auditStatus === filter || r.payStatus === filter
    );
  }, [records, filter]);

  const kpis = useMemo(() => computeAuditKpis(records), [records]);

  const approveInvoice = useCallback((inv) => {
    setRecords((prev) =>
      prev.map((r) => (r.inv === inv ? { ...r, payStatus: PAY_STATUS.APPROVED } : r))
    );
  }, []);

  const disputeInvoice = useCallback((inv) => {
    setRecords((prev) =>
      prev.map((r) => (r.inv === inv ? { ...r, payStatus: PAY_STATUS.DISPUTED } : r))
    );
  }, []);

  const releaseHold = useCallback((inv) => {
    setRecords((prev) =>
      prev.map((r) =>
        r.inv === inv
          ? { ...r, payStatus: PAY_STATUS.PENDING, auditStatus: AUDIT_STATUS.MATCHED, issue: "" }
          : r
      )
    );
  }, []);

  const approveAllClean = useCallback(() => {
    setRecords((prev) =>
      prev.map((r) =>
        r.auditStatus === AUDIT_STATUS.MATCHED && r.payStatus === PAY_STATUS.PENDING
          ? { ...r, payStatus: PAY_STATUS.APPROVED }
          : r
      )
    );
  }, []);

  return {
    records,
    setRecords,
    filtered,
    filter,
    setFilter,
    kpis,
    approveInvoice,
    disputeInvoice,
    releaseHold,
    approveAllClean,
  };
}
