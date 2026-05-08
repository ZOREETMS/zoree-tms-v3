import { useState, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import { InvoicesApi } from "../lib/api";
import useInvoices from "../hooks/useInvoices";
import { useEditGate } from "../hooks/useEditGate";
import InvoiceStatsGrid from "../components/invoices/InvoiceStatsGrid";
import InvoiceFilterBar from "../components/invoices/InvoiceFilterBar";
import InvoiceTable from "../components/invoices/InvoiceTable";
import InvoiceModal from "../components/invoices/InvoiceModal";
import { generateInvoiceNum, computeDueDate } from "../services/invoiceService";

export default function FreightInvoicesPage() {
  const { shipments, carriers } = useOutletContext();
  // QA #148 / QA #149: Freight Invoices writes (Import / New Invoice /
  // Approve / Dispute / Send-to-AP) must obey the Finance matrix for
  // both Finance and Viewer roles.
  const gate = useEditGate("invoices");
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editInvoice, setEditInvoice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState({ text: "", type: "" });

  const carrierNames = (carriers || []).map((c) => c.name).filter(Boolean).sort();

  const {
    filtered, stats, carriers: invoiceCarriers,
    search, setSearch,
    statusFilter, setStatusFilter,
    carrierFilter, setCarrierFilter,
    sortCol, sortAsc, toggleSort,
  } = useInvoices(invoices);

  function showToast(text, type = "info") {
    setToast({ text, type });
    setTimeout(() => setToast({ text: "", type: "" }), 4000);
  }

  useEffect(() => {
    loadInvoices();
  }, []);

  async function loadInvoices() {
    setLoading(true);
    try {
      const data = await InvoicesApi.list();
      // REQ-06: the domain endpoint returns { invoices: [...], total }.
      // Fall back to the legacy array shape if something else responded.
      const rows = Array.isArray(data?.invoices) ? data.invoices
                 : Array.isArray(data) ? data
                 : null;
      if (rows && rows.length) {
        setInvoices(rows.map(mapDbInvoice));
      } else {
        setInvoices(getSeedInvoices());
      }
    } catch {
      setInvoices(getSeedInvoices());
    } finally {
      setLoading(false);
    }
  }

  function openNewInvoice() {
    if (!gate.canEdit) return;            // QA #148/149 guard
    setEditInvoice(null);
    setModalOpen(true);
  }

  // Open the existing-invoice details modal when a row is clicked.
  // The InvoiceModal already supports edit mode when invoice.num is set.
  // QA #148/149: still allow the modal to OPEN under view access — the
  // modal becomes read-only via canEdit prop below — but block the New
  // Invoice path which would otherwise create a row.
  function openExistingInvoice(inv) {
    if (!inv) return;
    setEditInvoice(inv);
    setModalOpen(true);
  }

  async function handleSave(form) {
    if (!gate.canEdit) return;            // QA #148/149 guard
    setBusy(true);
    try {
      // REQ-06: for new invoices, submit through the tolerance-decision
      // endpoint. Server runs the decide() logic and returns the Approved
      // or Rejected outcome inline, including sentToAp status.
      if (!editInvoice) {
        // REQ-07: build the full shipment ID list from the primary select
        // + the comma-separated extras field. Duplicates removed, blanks
        // dropped; when there's only one, we still send as a single-element
        // array so the server can trust the input shape.
        const primary = (form.shipId || "").trim();
        const extras = (form.extraShipIds || "")
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        const ids = [...new Set([primary, ...extras].filter(Boolean))];
        const res = await InvoicesApi.submit({
          invoiceNumber: form.num,
          carrier: form.carrier,
          shipmentIds: ids.length ? ids : undefined,
          shipmentId: ids.length === 0 ? null : undefined,
          invoicedAmount: Number(form.amount) || 0,
          invoiceDate: form.date,
          paymentTerms: form.paymentTerms,
          notes: form.notes,
        });
        const d = res?.decision || {};
        // REQ-07: make the toast message surface which shipments were matched
        const consolidated = d.consolidated;
        const shipList = Array.isArray(d.shipmentsIdentified) ? d.shipmentsIdentified : [];
        const missing = Array.isArray(d.missingShipments) ? d.missingShipments : [];
        let coveragePrefix = "";
        if (consolidated) {
          coveragePrefix = `${shipList.length} shipments identified (${shipList.join(", ")})` +
            (missing.length ? ` — ${missing.length} missing: ${missing.join(", ")}` : "") + ". ";
        }
        const statusMsg = d.status === "Approved"
          ? (d.sentToAp
              ? `${coveragePrefix}Approved & sent to AP — ${d.reason || ""}`
              : `${coveragePrefix}Approved — ${d.reason || ""}`)
          : `${coveragePrefix}Rejected — ${d.reason || ""}`;
        showToast(`Invoice ${form.num}: ${statusMsg}`,
          d.status === "Approved" ? "success" : "warning");
      } else {
        // Editing an existing invoice — keep the legacy save path
        await InvoicesApi.save({
          id: editInvoice.id,
          invoice_number: form.num,
          carrier: form.carrier,
          shipment_id: form.shipId,
          invoice_date: form.date,
          due_date: form.due,
          agreed_rate: form.agreed,
          invoiced_amount: form.amount,
          status: form.status,
          payment_terms: form.paymentTerms,
          notes: form.notes,
        });
        showToast(`Invoice ${form.num} updated`, "success");
      }
      setModalOpen(false);
      loadInvoices();
    } catch (e) {
      // Fallback: update local state
      setInvoices((prev) => {
        const exists = prev.find((i) => i.num === form.num);
        if (exists) return prev.map((i) => (i.num === form.num ? form : i));
        return [form, ...prev];
      });
      showToast(`Invoice ${form.num} saved locally (server error: ${e?.message || "unknown"})`, "warning");
      setModalOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove(num) {
    if (!gate.canEdit) return;            // QA #148/149 guard
    const inv = invoices.find((i) => i.num === num);
    if (!inv) return;
    try {
      if (inv.id) {
        const updated = await InvoicesApi.approve(inv.id, "Manual override by reviewer");
        setInvoices((prev) => prev.map((i) => (i.num === num ? { ...i, ...mapDbInvoice(updated) } : i)));
        showToast(`Invoice ${num} approved & sent to AP`, "success");
        return;
      }
    } catch (e) {
      showToast(`Server rejected approval: ${e?.message || "unknown"}`, "warning");
    }
    // local-only fallback
    setInvoices((prev) => prev.map((i) => (i.num === num ? { ...i, status: "Approved" } : i)));
    showToast(`Invoice ${num} approved (local)`, "success");
  }

  async function handleDispute(num) {
    if (!gate.canEdit) return;            // QA #148/149 guard
    const inv = invoices.find((i) => i.num === num);
    if (!inv) return;
    try {
      if (inv.id) {
        const updated = await InvoicesApi.reject(inv.id, "Manual reject by reviewer");
        setInvoices((prev) => prev.map((i) => (i.num === num ? { ...i, ...mapDbInvoice(updated) } : i)));
        showToast(`Invoice ${num} rejected`, "warning");
        return;
      }
    } catch (e) {
      showToast(`Server rejected: ${e?.message || "unknown"}`, "warning");
    }
    setInvoices((prev) => prev.map((i) => (i.num === num ? { ...i, status: "Disputed" } : i)));
    showToast(`Invoice ${num} disputed (local)`, "warning");
  }

  // REQ-06: send an Approved invoice to AP (for the case where tolerance
  // auto-decided Approved but sending was deferred, or after a manual
  // approve override).
  async function handleSendToAp(num) {
    if (!gate.canEdit) return;            // QA #148/149 guard
    const inv = invoices.find((i) => i.num === num);
    if (!inv || !inv.id) return;
    try {
      const updated = await InvoicesApi.sendToAp(inv.id);
      setInvoices((prev) => prev.map((i) => (i.num === num ? { ...i, ...mapDbInvoice(updated) } : i)));
      showToast(`Invoice ${num} sent to AP`, "success");
    } catch (e) {
      showToast(`Send-to-AP failed: ${e?.message || "unknown"}`, "warning");
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text3)" }}>
        Loading invoices...
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Freight Invoices</div>
          <div className="page-sub">3-way match, audit, and AP processing</div>
        </div>
        <div className="header-actions">
          <button
            className="btn btn-secondary btn-sm"
            {...gate.editProps()}          /* QA #148/149 */
          >
            📥 Import
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={openNewInvoice}
            {...gate.editProps()}          /* QA #148/149 */
          >
            + New Invoice
          </button>
        </div>
      </div>

      <div className="page-content">
        <InvoiceStatsGrid stats={stats} />

        <InvoiceFilterBar
          search={search}
          onSearchChange={setSearch}
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          carrierFilter={carrierFilter}
          onCarrierChange={setCarrierFilter}
          carriers={invoiceCarriers.length ? invoiceCarriers : carrierNames}
        />

        <InvoiceTable
          invoices={filtered}
          sortCol={sortCol}
          sortAsc={sortAsc}
          onSort={toggleSort}
          /* QA #148/149: row-level write actions disappear under 'view'.
             onOpenInvoice stays — opening the modal is a read action. */
          onApprove={gate.canEdit ? handleApprove : undefined}
          onDispute={gate.canEdit ? handleDispute : undefined}
          onSendToAp={gate.canEdit ? handleSendToAp : undefined}
          onOpenInvoice={openExistingInvoice}
          canEdit={gate.canEdit}
        />
      </div>

      {modalOpen && (
        <InvoiceModal
          invoice={editInvoice}
          shipments={shipments || []}
          carriers={carrierNames}
          /* QA #148/149: when matrix says 'view', InvoiceModal still
             renders so users can read details, but onSave is gated and
             the canEdit prop tells the modal to hide its Save button. */
          onSave={gate.canEdit ? handleSave : undefined}
          canEdit={gate.canEdit}
          onClose={() => setModalOpen(false)}
          busy={busy}
        />
      )}

      {toast.text && (
        <div className="toast-wrap">
          <div className="toast">
            <span>{toast.type === "success" ? "✅" : toast.type === "warning" ? "⚠️" : "ℹ️"}</span>
            <span>{toast.text}</span>
          </div>
        </div>
      )}
    </>
  );
}

function mapDbInvoice(row) {
  return {
    id: row.id,
    num: row.invoice_number || row.num || "",
    carrier: row.carrier || "",
    shipId: row.shipment_id || row.shipId || "",
    // REQ-07: the full list (consolidated invoices have >1 id)
    shipIds: Array.isArray(row.shipment_ids) ? row.shipment_ids
            : (row.shipment_id ? [row.shipment_id] : []),
    date: row.invoice_date || row.date || "",
    due: row.due_date || row.due || "",
    agreed: parseFloat(row.agreed_cost ?? row.agreed_rate ?? row.agreed) || 0,
    amount: parseFloat(row.invoiced_amount ?? row.amount) || 0,
    status: row.status || "Pending",
    paymentTerms: row.payment_terms || "NET30",
    notes: row.notes || "",
    // REQ-06 audit fields
    variance: row.variance != null ? parseFloat(row.variance) : null,
    variancePct: row.variance_pct != null ? parseFloat(row.variance_pct) : null,
    tolerancePct: row.tolerance_pct != null ? parseFloat(row.tolerance_pct) : null,
    toleranceAbs: row.tolerance_abs_usd != null ? parseFloat(row.tolerance_abs_usd) : null,
    decisionReason: row.decision_reason || "",
    decidedAt: row.decided_at || null,
    decidedBy: row.decided_by || null,
    sentToApAt: row.sent_to_ap_at || null,
    sentToApBy: row.sent_to_ap_by || null,
  };
}

function getSeedInvoices() {
  return [
    { num: "INV-84421", carrier: "SWIFT TRANSPORT", shipId: "SHP-2024-1840", date: "2026-03-01", due: "2026-03-31", agreed: 3240, amount: 3240, status: "Approved", paymentTerms: "NET30", notes: "" },
    { num: "INV-84422", carrier: "OLD DOMINION", shipId: "SHP-2024-1841", date: "2026-03-02", due: "2026-04-01", agreed: 980, amount: 980, status: "Approved", paymentTerms: "NET30", notes: "" },
    { num: "INV-84423", carrier: "JB HUNT", shipId: "SHP-2024-1851", date: "2026-03-03", due: "2026-04-02", agreed: 2750, amount: 3070, status: "Disputed", paymentTerms: "NET30", notes: "Fuel surcharge overage" },
    { num: "INV-84424", carrier: "WERNER ENTERPRISES", shipId: "SHP-2024-1844", date: "2026-03-04", due: "2026-04-03", agreed: 2600, amount: 2600, status: "Pending", paymentTerms: "NET30", notes: "" },
    { num: "INV-84425", carrier: "XPO LOGISTICS", shipId: "SHP-2024-1848", date: "2026-03-04", due: "2026-04-03", agreed: 1850, amount: 2100, status: "Disputed", paymentTerms: "NET30", notes: "Accessorial not agreed" },
    { num: "INV-84426", carrier: "SCHNEIDER NATIONAL", shipId: "SHP-2024-1845", date: "2026-03-05", due: "2026-04-04", agreed: 4100, amount: 3980, status: "Pending", paymentTerms: "NET30", notes: "Rate applied incorrectly" },
    { num: "INV-84427", carrier: "SWIFT TRANSPORT", shipId: "SHP-2024-1849", date: "2026-03-05", due: "2026-04-04", agreed: 2200, amount: 2200, status: "Pending", paymentTerms: "NET30", notes: "" },
    { num: "INV-84428", carrier: "FEDEX FREIGHT", shipId: "SHP-2024-1843", date: "2026-03-01", due: "2026-03-31", agreed: 1420, amount: 1420, status: "Approved", paymentTerms: "NET30", notes: "" },
    { num: "INV-84429", carrier: "OLD DOMINION", shipId: "SHP-2024-1842", date: "2026-03-02", due: "2026-04-01", agreed: 1560, amount: 1560, status: "Approved", paymentTerms: "NET30", notes: "" },
    { num: "INV-84430", carrier: "JB HUNT", shipId: "SHP-2024-1850", date: "2026-03-06", due: "2026-04-05", agreed: 3400, amount: 3400, status: "Pending", paymentTerms: "NET30", notes: "" },
    { num: "INV-84431", carrier: "SWIFT TRANSPORT", shipId: "SHP-2024-1852", date: "2026-03-06", due: "2026-04-05", agreed: 2800, amount: 2800, status: "Pending", paymentTerms: "NET30", notes: "" },
    { num: "INV-84432", carrier: "WERNER ENTERPRISES", shipId: "SHP-2024-1846", date: "2026-03-03", due: "2026-04-02", agreed: 3100, amount: 3100, status: "Approved", paymentTerms: "NET30", notes: "" },
  ];
}
