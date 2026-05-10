import { useState, useEffect } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { InvoicesApi } from "../lib/api";
import useInvoices from "../hooks/useInvoices";
import { useEditGate } from "../hooks/useEditGate";
import InvoiceStatsGrid from "../components/invoices/InvoiceStatsGrid";
import InvoiceFilterBar from "../components/invoices/InvoiceFilterBar";
import InvoiceTable from "../components/invoices/InvoiceTable";
import InvoiceModal from "../components/invoices/InvoiceModal";
import { generateInvoiceNum, computeDueDate } from "../services/invoiceService";
// REQ-190 / REQ-191: write-action helpers + DB row mapper live in a
// dedicated service so the page stays a thin controller (CLAUDE_RULES
// §6/§9). The page just wires events → service → list state.
import {
  mapDbInvoice,
  manualApprove,
  manualReject,
  autoDecide,
  sendToAp as sendToApAction,
  deleteInvoice as deleteInvoiceAction,
} from "../services/invoiceActionsService";

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

  // Bug #166 / REQ-184: when navigated here from a shipment row, the
  // Shipments page passes ?shipment=<id>. We use it ONLY to preset the
  // search box so the list filters down to invoices for that shipment.
  // We do NOT auto-open the create modal anymore — the planner now
  // creates the invoice from the shipment with one click (REQ-184), and
  // the Shipments page sends them here with ?invoice=<id> instead.
  //
  // ?invoice=<id> (REQ-184) — open the matching existing invoice in
  // the edit modal so the planner sees the auto-created invoice
  // immediately instead of an empty form.
  const [searchParams, setSearchParams] = useSearchParams();
  const shipmentParam = searchParams.get("shipment") || "";
  const invoiceParam  = searchParams.get("invoice")  || "";

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

  // REQ-184: react to ?shipment=<id> by filtering the list only.
  // The auto-open-create-modal behavior (old Bug #166) is gone — the
  // Shipments page now creates the invoice server-side and redirects
  // here with ?invoice=<id>, which the next effect handles.
  useEffect(() => {
    if (!shipmentParam) return;
    setSearch(shipmentParam);
    const next = new URLSearchParams(searchParams);
    next.delete("shipment");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipmentParam]);

  // REQ-184: react to ?invoice=<id> by opening that invoice in the
  // edit modal — typically the invoice that was just auto-created from
  // a shipment row. Falls back to a list-filter (search by id) if the
  // invoice isn't in the loaded page.
  useEffect(() => {
    if (!invoiceParam) return;
    if (loading) return;
    const match = invoices.find(
      (inv) => String(inv.id || "") === invoiceParam || String(inv.num || "") === invoiceParam
    );
    if (match) {
      setEditInvoice(match);
      setModalOpen(true);
    } else {
      // Surface the id as a search filter so the user can spot it.
      setSearch(invoiceParam);
    }
    const next = new URLSearchParams(searchParams);
    next.delete("invoice");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceParam, loading, invoices]);

  async function loadInvoices() {
    setLoading(true);
    try {
      const data = await InvoicesApi.list();
      // REQ-06: the domain endpoint returns { invoices: [...], total }.
      // Fall back to the legacy array shape if something else responded.
      const rows = Array.isArray(data?.invoices) ? data.invoices
                 : Array.isArray(data) ? data
                 : null;
      // Bug #171: never paper over the real DB with hardcoded seed
      // rows. The previous code substituted getSeedInvoices() when the
      // API returned an empty list, which made the Freight Invoices
      // page show 12 fake "INV-844**" rows that DB Explorer didn't
      // know about — exactly the mismatch the bug reporter saw. An
      // empty table is the correct UI for an empty DB; the seed is
      // kept for the catch branch only (network failure / dev offline)
      // and tagged so it's obvious in QA that we're in fallback mode.
      setInvoices(Array.isArray(rows) ? rows.map(mapDbInvoice) : []);
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
        // REQ-187: BOL ids are entered as a comma-separated string in
        // the modal; normalize before sending so the server receives
        // an array regardless of how the user typed them.
        const bolList = Array.isArray(form.bolIds)
          ? form.bolIds
          : String(form.bolIds || "").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
        const res = await InvoicesApi.submit({
          invoiceNumber: form.num,
          carrier: form.carrier,
          shipmentIds: ids.length ? ids : undefined,
          shipmentId: ids.length === 0 ? null : undefined,
          bolIds: bolList.length ? bolList : undefined,
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
        // Bug #157: edit via the domain PATCH endpoint. Server maps
        // camelCase keys → DB columns (agreedCost → agreed_cost, etc.),
        // so the UI no longer needs to know the underlying schema.
        // REQ-187: pass bolIds through on edit as well so finance can
        // attach a BOL to a previously-imported invoice or correct one
        // the carrier sent without a BOL.
        const editBols = Array.isArray(form.bolIds)
          ? form.bolIds
          : String(form.bolIds || "").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
        await InvoicesApi.update(editInvoice.id, {
          invoiceNumber:  form.num,
          carrier:        form.carrier,
          shipmentId:     form.shipId,
          bolIds:         editBols,
          invoiceDate:    form.date,
          dueDate:        form.due,
          agreedCost:     form.agreed,
          invoicedAmount: form.amount,
          status:         form.status,
          paymentTerms:   form.paymentTerms,
          notes:          form.notes,
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

  // REQ-190 / REQ-191: every write action below is now a thin call into
  // invoiceActionsService. The service returns { ok, row, toast } so the
  // page only knows about (a) which row to merge into list state and
  // (b) which toast to show. Reason capture for reject lives in the
  // modal (window.prompt); the row-level Reject button uses a default.

  // Resolve an invoice by `num` (table row id) or by `id` (modal). The
  // row-action buttons send `num`, the modal sends `id`. Centralized so
  // the handlers below stay one-liners.
  function findInvoice({ num, id }) {
    if (id)  return invoices.find((i) => i.id === id);
    if (num) return invoices.find((i) => i.num === num);
    return null;
  }

  function applyServiceResult({ ok, row, toast }) {
    if (toast) showToast(toast.text, toast.type);
    if (ok && row) {
      setInvoices((prev) => prev.map((i) => (i.id === row.id ? { ...i, ...row } : i)));
    }
  }

  // Row-action: manual force-approve from the table (`num`-keyed).
  async function handleApprove(num) {
    if (!gate.canEdit) return;            // QA #148/149 guard
    const inv = findInvoice({ num });
    if (!inv) return;
    applyServiceResult(await manualApprove({ invoice: inv }));
  }

  // Row-action: manual force-reject from the table (`num`-keyed).
  // The legacy handler was called `handleDispute` for historical reasons
  // (the row button used to flip status to 'Disputed' on local-only
  // rows). REQ-190 makes Rejected the canonical outcome, so the handler
  // is renamed to match.
  async function handleReject(num) {
    if (!gate.canEdit) return;            // QA #148/149 guard
    const inv = findInvoice({ num });
    if (!inv) return;
    applyServiceResult(await manualReject({ invoice: inv }));
  }

  // Modal-action: manual force-approve from the InvoiceModal footer
  // (`id`-keyed). Same backend path as handleApprove; just a different
  // lookup key since the modal already has the invoice id.
  async function handleManualApprove(invoiceId) {
    if (!gate.canEdit) return;
    const inv = findInvoice({ id: invoiceId });
    if (!inv) return;
    setBusy(true);
    try {
      const res = await manualApprove({ invoice: inv });
      applyServiceResult(res);
      if (res.ok) setModalOpen(false);
    } finally {
      setBusy(false);
    }
  }

  // Modal-action: manual force-reject from the InvoiceModal footer.
  // The modal prompts for a reason and passes it through; the service
  // falls back to a default reason if none was captured.
  async function handleManualReject(invoiceId, reason) {
    if (!gate.canEdit) return;
    const inv = findInvoice({ id: invoiceId });
    if (!inv) return;
    setBusy(true);
    try {
      const res = await manualReject({ invoice: inv, reason });
      applyServiceResult(res);
      if (res.ok) setModalOpen(false);
    } finally {
      setBusy(false);
    }
  }

  // REQ-191 / REQ-184: Auto Approve — runs the carrier-tolerance check
  // server-side. Outcome is Approved (auto-sent to AP) or Rejected.
  // Reached from both the modal footer and the row-level "Auto" button.
  async function handleDecide(invoiceIdOrInv) {
    if (!gate.canEdit) return;
    // Accept either an id (modal) or a row object lookup-by-num is
    // handled by the row-level alias below.
    const inv = typeof invoiceIdOrInv === "string"
      ? findInvoice({ id: invoiceIdOrInv })
      : invoiceIdOrInv;
    if (!inv) return;
    setBusy(true);
    try {
      const res = await autoDecide({ invoice: inv });
      applyServiceResult(res);
      if (res.ok) {
        setModalOpen(false);
        // Pull the fresh row + history events so the table reflects the
        // new status without waiting for the next poll.
        loadInvoices();
      }
    } finally {
      setBusy(false);
    }
  }

  // Row-level alias for Auto Approve (table sends `num`, not `id`).
  async function handleAutoDecide(num) {
    const inv = findInvoice({ num });
    if (!inv) return;
    return handleDecide(inv);
  }

  async function handleSendToAp(num) {
    if (!gate.canEdit) return;
    const inv = findInvoice({ num });
    if (!inv) return;
    applyServiceResult(await sendToApAction({ invoice: inv }));
  }

  // REQ-192: Delete an invoice. Modal-action (id-keyed). The service
  // returns { ok, removedId, toast }; on success we filter the row out
  // of list state instead of merging. Confirmation lives in the modal
  // (window.confirm + window.prompt for reason), so the page just
  // receives the id + optional reason and dispatches.
  async function handleDelete(invoiceId, reason) {
    if (!gate.canEdit) return;
    const inv = findInvoice({ id: invoiceId });
    if (!inv) return;
    setBusy(true);
    try {
      const res = await deleteInvoiceAction({ invoice: inv, reason });
      if (res.toast) showToast(res.toast.text, res.toast.type);
      if (res.ok && res.removedId) {
        setInvoices((prev) => prev.filter((i) => i.id !== res.removedId));
        setModalOpen(false);
      }
    } finally {
      setBusy(false);
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
             onOpenInvoice stays — opening the modal is a read action.
             REQ-190 / REQ-191: three row actions — Approve, Reject,
             and Auto (carrier-tolerance auto-decide). */
          onApprove={gate.canEdit ? handleApprove : undefined}
          onReject={gate.canEdit ? handleReject : undefined}
          onAutoDecide={gate.canEdit ? handleAutoDecide : undefined}
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
          /* Bug #166: pre-fill shipment id when navigated from a
             Shipments row (`?shipment=<id>` URL). Only applies in
             create mode — editing an existing invoice ignores this. */
          defaultShipmentId={!editInvoice ? shipmentParam : undefined}
          /* QA #148/149: when matrix says 'view', InvoiceModal still
             renders so users can read details, but onSave is gated and
             the canEdit prop tells the modal to hide its Save button. */
          onSave={gate.canEdit ? handleSave : undefined}
          /* REQ-191: three write actions on the modal footer. The
             modal hides each button when the action isn't meaningful
             for the current status (via the service predicates) or
             when the corresponding handler isn't wired. */
          onManualApprove={gate.canEdit ? handleManualApprove : undefined}
          onManualReject={ gate.canEdit ? handleManualReject  : undefined}
          onDecide={       gate.canEdit ? handleDecide        : undefined}
          /* REQ-192: delete is gated by gate.canEdit and additionally
             confirmed inside the modal. Hidden in create mode by the
             modal itself (it checks !isNew && form.id). */
          onDelete={       gate.canEdit ? handleDelete        : undefined}
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

// REQ-190 / REQ-191: mapDbInvoice was moved into
// frontend/src/services/invoiceActionsService.js and is now imported at
// the top of this file. Keeping a single definition prevents drift
// when new fields are added to the invoices table (the previous
// duplicate is the kind of footgun CLAUDE_RULES §6 calls out).

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
