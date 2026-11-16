import { useState } from "react";
import { useFreightAudit } from "../hooks/useFreightAudit";
import { useEditGate } from "../hooks/useEditGate";
import AuditStats from "../components/freight-audit/AuditStats";
import AuditFilterBar from "../components/freight-audit/AuditFilterBar";
import AuditTable from "../components/freight-audit/AuditTable";

export default function FreightAuditPage() {
  const {
    filtered, filter, setFilter, kpis, loading, error, busy,
    approveInvoice, disputeInvoice, releaseHold, approveAllClean, runAudit,
  } = useFreightAudit();

  // QA #148 / QA #149: Finance module 'view' must collapse Approve /
  // Dispute / Release / Approve-all / Run Auto-Audit on the audit page,
  // for both Finance and Viewer roles. Gate hook checks the matrix.
  const gate = useEditGate("freight_audit");

  const [toast, setToast] = useState(null);

  function showToast(message, type) {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  // Each handler saves through the API; the toast reports what the server did.
  async function handleApprove(id) {
    if (!gate.canEdit) return;            // QA #148/149 guard
    const out = await approveInvoice(id);
    showToast(out.toast.text, out.toast.type);
  }

  async function handleDispute(id) {
    if (!gate.canEdit) return;            // QA #148/149 guard
    const out = await disputeInvoice(id);
    showToast(out.toast.text, out.toast.type);
  }

  async function handleRelease(id) {
    if (!gate.canEdit) return;            // QA #148/149 guard
    const out = await releaseHold(id);
    showToast(out.toast.text, out.toast.type);
  }

  async function handleRunAudit() {
    if (!gate.canEdit) return;            // QA #148/149 guard
    const out = await runAudit();
    showToast(out.summary, out.ok ? "info" : "warning");
  }

  async function handleApproveAllClean() {
    if (!gate.canEdit) return;            // QA #148/149 guard
    const out = await approveAllClean();
    showToast(out.total ? `${out.approved} of ${out.total} matched invoices approved` : "No matched invoices waiting for approval",
      out.total && out.approved === out.total ? "success" : "info");
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
            disabled={busy || !gate.canEdit}
          >
            Run Auto-Audit
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleApproveAllClean}
            {...gate.editProps()}          /* QA #148/149 */
            disabled={busy || !gate.canEdit}
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
          emptyText={loading ? "Loading invoices…" : error ? `Could not load invoices: ${error}` : filter ? "No invoices match the current filter" : "No invoices in this domain yet"}
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
