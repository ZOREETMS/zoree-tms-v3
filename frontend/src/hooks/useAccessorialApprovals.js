import { useCallback, useEffect, useState } from "react";
import { listApprovals, addApproval, removeApproval } from "../services/accessorialApprovalService";

// Server state for one shipment's approved extras.
export default function useAccessorialApprovals(shipmentId) {
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!shipmentId) return;
    setLoading(true);
    setError("");
    try { setApprovals(await listApprovals(shipmentId)); }
    catch (e) { setError(e.message || "Could not load approvals"); }
    finally { setLoading(false); }
  }, [shipmentId]);

  useEffect(() => { reload(); }, [reload]);

  const add = useCallback(async (form) => { await addApproval(shipmentId, form); await reload(); }, [shipmentId, reload]);
  const remove = useCallback(async (id) => { await removeApproval(shipmentId, id); await reload(); }, [shipmentId, reload]);

  return { approvals, loading, error, add, remove, reload };
}
