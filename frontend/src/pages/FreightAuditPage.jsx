import { useState } from "react";
import { useFreightAudit } from "../hooks/useFreightAudit";
import { SEED_AUDIT_DATA } from "../services/freightAuditService";
import { useEditGate } from "../hooks/useEditGate";
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

  // QA #148 / QA #149: Finance module 'view' must collapse Approve /
  // Dispute / Release / Approve-all / Run Auto-Audit on the audit page,
  // for both Finance and Viewer roles. Gate hook checks the matrix.
  const gate = useEditGate("freight_audit");

  const [toast, setToast] = useState(null);

  function showToast(message, type) {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  function handleApprove(inv) {
    if (!gate.canEdit) return;            // QA #148/149 guard
    approveInvoice(inv);
    showToast(`${inv} approved for payment`, "success");
  }

  function handleDispute(inv) {
    if (!gate.canEdit) return;            // QA #148/149 guard
    disputeInvoice(inv);
    showToast(`${inv} marked as disputed`, "warning");
  }

  function handleRelease(inv) {
    if (!gate.canEdit) return;            // QA #148/149 guard
    releaseHold(inv);
    showToast(`${inv} released — pending approval`, "info");
  }

  function handleRunAudit() {
    if (!gate.canEdit) return;            // QA #148/149 guard
    showToast("Auto-audit complete — " + kpis.discrepancies + " discrepancies flagged", "warning");
  }

  function handleApproveAllClean() {
    if (!gate.canEdit) return;            // QA #148/149 guard
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
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleRunAudit}
            {...gate.editProps()}          /* QA #148/149 */
          >
            Run Auto-Audit
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleApproveAllClean}
            {...gate.editProps()}          /* QA #148/149 */
          >
            Approve All Clean
          </button>
        </div>
      </div>

      {/* Page Content */}
      <div className="page-content">
        <AuditStats kpis={kpis} />
        <AuditTable
          records={filtered}
          /* QA #148/149: collapse row-level write actions when matrix
             says 'view'. AuditTable falls back to read-only rendering
             when these are undefined. */
          onApprove={gate.canEdit ? handleApprove : undefined}
          onDispute={gate.canEdit ? handleDispute : undefined}
          onRelease={gate.canEdit ? handleRelease : undefined}
          canEdit={gate.canEdit}
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
