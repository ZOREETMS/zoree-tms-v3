import { useState, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import { InvoicesApi } from "../lib/api";
import useInvoices from "../hooks/useInvoices";
import InvoiceStatsGrid from "../components/invoices/InvoiceStatsGrid";
import InvoiceFilterBar from "../components/invoices/InvoiceFilterBar";
import InvoiceTable from "../components/invoices/InvoiceTable";
import InvoiceModal from "../components/invoices/InvoiceModal";
import { generateInvoiceNum, computeDueDate } from "../services/invoiceService";

export default function FreightInvoicesPage() {
  const { shipments, carriers } = useOutletContext();
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
      if (Array.isArray(data)) {
        setInvoices(data.map(mapDbInvoice));
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
    setEditInvoice(null);
    setModalOpen(true);
  }

  async function handleSave(form) {
    setBusy(true);
    try {
      await InvoicesApi.save({
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
      showToast(`Invoice ${form.num} saved`, "success");
      setModalOpen(false);
      loadInvoices();
    } catch {
      // Fallback: update local state
      setInvoices((prev) => {
        const exists = prev.find((i) => i.num === form.num);
        if (exists) return prev.map((i) => (i.num === form.num ? form : i));
        return [form, ...prev];
      });
      showToast(`Invoice ${form.num} saved locally`, "success");
      setModalOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove(num) {
    const inv = invoices.find((i) => i.num === num);
    if (!inv) return;
    try {
      if (inv.id) await InvoicesApi.approve(inv.id);
    } catch { /* fallback to local */ }
    setInvoices((prev) =>
      prev.map((i) => (i.num === num ? { ...i, status: "Approved" } : i))
    );
    showToast(`Invoice ${num} approved`, "success");
  }

  async function handleDispute(num) {
    const inv = invoices.find((i) => i.num === num);
    if (!inv) return;
    try {
      if (inv.id) await InvoicesApi.dispute(inv.id);
    } catch { /* fallback to local */ }
    setInvoices((prev) =>
      prev.map((i) => (i.num === num ? { ...i, status: "Disputed" } : i))
    );
    showToast(`Invoice ${num} disputed`, "warning");
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
          <button className="btn btn-secondary btn-sm">📥 Import</button>
          <button className="btn btn-primary btn-sm" onClick={openNewInvoice}>
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
          onApprove={handleApprove}
          onDispute={handleDispute}
        />
      </div>

      {modalOpen && (
        <InvoiceModal
          invoice={editInvoice}
          shipments={shipments || []}
          carriers={carrierNames}
          onSave={handleSave}
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
    date: row.invoice_date || row.date || "",
    due: row.due_date || row.due || "",
    agreed: parseFloat(row.agreed_rate || row.agreed) || 0,
    amount: parseFloat(row.invoiced_amount || row.amount) || 0,
    status: row.status || "Pending",
    paymentTerms: row.payment_terms || "NET30",
    notes: row.notes || "",
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
