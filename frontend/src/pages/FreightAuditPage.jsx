import { useState } from "react";
import { useFreightAudit } from "../hooks/useFreightAudit";
import { SEED_AUDIT_DATA } from "../services/freightAuditService";
import AuditStats from "../components/freight-audit/AuditStats";
import AuditFilterBar from "../components/freight-audit/AuditFilterBar";
import AuditTable from "../components/freight-audit/AuditTable";

export default function FreightAuditPage() {
  const {
    filtered,
    filter,
    setFilter,
    kpis,
    approveInvoice,
    disputeInvoice,
    releaseHold,
    approveAllClean,
  } = useFreightAudit(SEED_AUDIT_DATA);

  const [toast, setToast] = useState(null);

  function showToast(message, type) {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  function handleApprove(inv) {
    approveInvoice(inv);
    showToast(`${inv} approved for payment`, "success");
  }

  function handleDispute(inv) {
    disputeInvoice(inv);
    showToast(`${inv} marked as disputed`, "warning");
  }

  function handleRelease(inv) {
    releaseHold(inv);
    showToast(`${inv} released — pending approval`, "info");
  }

  function handleRunAudit() {
    showToast("Auto-audit complete — " + kpis.discrepancies + " discrepancies flagged", "warning");
  }

  function handleApproveAllClean() {
    approveAllClean();
    showToast("All matched invoices approved", "success");
  }

  return (
    <div className="page active">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Freight Audit</div>
          <div className="page-sub">Invoice matching, discrepancy detection, and payment approval</div>
        </div>
        <div className="header-actions">
          <AuditFilterBar filter={filter} onFilterChange={setFilter} />
          <button className="btn btn-secondary btn-sm" onClick={handleRunAudit}>
            Run Auto-Audit
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleApproveAllClean}>
            Approve All Clean
          </button>
        </div>
      </div>

      {/* Page Content */}
      <div className="page-content">
        <AuditStats kpis={kpis} />
        <AuditTable
          records={filtered}
          onApprove={handleApprove}
          onDispute={handleDispute}
          onRelease={handleRelease}
        />
      </div>

      {/* Toast */}
      {toast && (
        <div className="toast-wrap">
          <div className="toast">
            <span style={{ fontSize: 16 }}>
              {toast.type === "success" ? "✅" : toast.type === "warning" ? "⚠️" : "ℹ️"}
            </span>
            <span style={{ fontSize: 13 }}>{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}
