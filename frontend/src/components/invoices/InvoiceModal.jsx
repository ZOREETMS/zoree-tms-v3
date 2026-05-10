import { useState, useEffect } from "react";
import { INVOICE_STATUSES, PAYMENT_TERMS, emptyInvoice } from "../../types/invoice";
import { generateInvoiceNum, computeDueDate } from "../../services/invoiceService";
import InvoiceCostLines from "./InvoiceCostLines";

export default function InvoiceModal({
  invoice,
  shipments,
  carriers,
  // Bug #166: when the modal is opened from the Shipments page's
  // "🧾 Invoice" button (route: /freight-invoices?shipment=<id>),
  // FreightInvoicesPage passes the id here so the new-invoice form
  // opens pre-filled with the shipment id and the carrier inferred
  // from the matching shipment row. No-op for the regular New Invoice
  // button or for Edit (which gets its values from `invoice`).
  defaultShipmentId,
  onSave,
  onClose,
  busy,
  canEdit,
}) {
  const isNew = !invoice?.num;
  const [form, setForm] = useState(() => {
    if (invoice) return { ...invoice };
    const empty = emptyInvoice();
    empty.num = generateInvoiceNum();
    empty.due = computeDueDate(empty.date, "NET30");
    if (defaultShipmentId) {
      empty.shipId = defaultShipmentId;
      const match = (shipments || []).find((s) => String(s.id) === String(defaultShipmentId));
      if (match && match.carrier) empty.carrier = match.carrier;
    }
    return empty;
  });

  useEffect(() => {
    if (invoice) setForm({ ...invoice });
  }, [invoice]);

  function handleField(field, value) {
    const next = { ...form, [field]: value };
    if (field === "date" || field === "paymentTerms") {
      next.due = computeDueDate(next.date || form.date, next.paymentTerms || form.paymentTerms);
    }
    setForm(next);
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSave(form);
  }

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 620 }}>
        <div className="modal-header">
          <div className="modal-title">
            {isNew ? "New Invoice" : `Edit ${form.num}`}
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-grid">
              <div className="form-group">
                <label>Invoice #</label>
                <input value={form.num} readOnly style={{ opacity: 0.6 }} />
              </div>

              <div className="form-group">
                <label>Carrier</label>
                <select
                  value={form.carrier}
                  onChange={(e) => handleField("carrier", e.target.value)}
                  required
                >
                  <option value="">— Select Carrier —</option>
                  {carriers.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Primary Shipment</label>
                <select
                  value={form.shipId}
                  onChange={(e) => handleField("shipId", e.target.value)}
                >
                  <option value="">— Select Shipment —</option>
                  {shipments.map((s) => (
                    <option key={s.id} value={s.id}>{s.id}</option>
                  ))}
                </select>
              </div>

              {/* REQ-07: consolidated invoice — additional shipment IDs */}
              <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                <label>Additional shipments (optional, consolidated invoice)</label>
                <input
                  type="text"
                  placeholder="Comma-separated, e.g. SHP-2026-1234, SHP-2026-5678"
                  value={form.extraShipIds || ""}
                  onChange={(e) => handleField("extraShipIds", e.target.value)}
                />
                <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 4 }}>
                  Leave blank for a single-shipment invoice. For a consolidated invoice, list every additional shipment id — the server will sum their agreed costs and auto-decide approve/reject against the carrier tolerance.
                </div>
              </div>

              {/* REQ-187: BOL identifier(s) on the invoice. Carrier-
                  submitted invoices include the BOL the carrier billed
                  for; the server validates it against the shipment of
                  record before approving costs. Direct-create invoices
                  inherit this from shipment.bol_number automatically. */}
              <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                <label>BOL ID(s)</label>
                <input
                  type="text"
                  placeholder="Comma-separated. Leave blank for direct-create invoices."
                  value={
                    Array.isArray(form.bolIds)
                      ? form.bolIds.join(", ")
                      : (form.bolIds || "")
                  }
                  onChange={(e) => handleField("bolIds", e.target.value)}
                />
                <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 4 }}>
                  When the carrier sends an invoice with a BOL, finance can validate the BOL against the shipment of record. Mismatches are auto-rejected.
                </div>
              </div>

              <div className="form-group">
                <label>Status</label>
                <select
                  value={form.status}
                  onChange={(e) => handleField("status", e.target.value)}
                >
                  {INVOICE_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Invoice Date</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => handleField("date", e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Payment Terms</label>
                <select
                  value={form.paymentTerms}
                  onChange={(e) => handleField("paymentTerms", e.target.value)}
                >
                  {PAYMENT_TERMS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Due Date</label>
                <input
                  type="date"
                  value={form.due}
                  onChange={(e) => handleField("due", e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Agreed Rate ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.agreed}
                  onChange={(e) => handleField("agreed", parseFloat(e.target.value) || 0)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Invoiced Amount ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => handleField("amount", parseFloat(e.target.value) || 0)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Variance</label>
                <input
                  readOnly
                  style={{ opacity: 0.6 }}
                  value={
                    form.amount - form.agreed !== 0
                      ? `${form.amount - form.agreed > 0 ? "+" : ""}$${Math.abs(form.amount - form.agreed).toLocaleString()}`
                      : "—"
                  }
                />
              </div>

              <div className="form-group full">
                <label>Notes</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => handleField("notes", e.target.value)}
                  placeholder="Optional notes..."
                />
              </div>
            </div>

            {/* REQ-186: per-line cost breakdown. Only renders for
                existing invoices (we need the invoice id to fetch its
                lines). For new invoices the user fills the high-level
                Invoiced Amount above; cost lines are written by the
                server when the invoice is created. */}
            {form.id && (
              <InvoiceCostLines
                invoiceId={form.id}
                canEdit={canEdit !== false}
                legacyAgreed={form.agreed}
                legacyAmount={form.amount}
              />
            )}

            {/* Bug #167: Consolidated Invoice — shipment-wise breakdown.
                Renders only when the invoice covers more than one
                shipment (REQ-07 consolidated case). Each row shows the
                shipment id, route, mode, status, and that shipment's
                agreed cost (shipments.total_cost) so finance can see
                the per-leg numbers that sum to the invoice's
                "Agreed Rate" total. Sources:
                  - form.shipIds[]      — the canonical shipment_ids list
                                          on consolidated invoices.
                  - form.shipId         — back-compat fallback.
                  - shipments prop      — the shipments outlet snapshot. */}
            {(() => {
              const ids = (Array.isArray(form.shipIds) && form.shipIds.length
                ? form.shipIds
                : (form.shipId ? [form.shipId] : [])
              ).map(String);
              if (ids.length < 2) return null;
              const shipById = new Map((shipments || []).map((s) => [String(s.id), s]));
              const breakdown = ids.map((sid) => ({
                id: sid,
                ship: shipById.get(sid) || null,
              }));
              const sumAgreed = breakdown.reduce(
                (acc, b) => acc + (b.ship?.total_cost || 0),
                0
              );
              const sumInvoiced = Number(form.amount) || 0;
              return (
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginTop: 12, padding: "14px 0 0" }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                    Consolidated Shipments ({ids.length})
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ textAlign: "left", color: "var(--text3)" }}>
                          <th style={{ padding: "4px 6px" }}>Shipment</th>
                          <th style={{ padding: "4px 6px" }}>Route</th>
                          <th style={{ padding: "4px 6px" }}>Mode</th>
                          <th style={{ padding: "4px 6px" }}>Status</th>
                          <th style={{ padding: "4px 6px", textAlign: "right" }}>Agreed Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {breakdown.map((b) => (
                          <tr key={b.id} style={{ borderTop: "1px solid var(--border)" }}>
                            <td className="mono" style={{ padding: "6px", fontWeight: 600 }}>{b.id}</td>
                            <td style={{ padding: "6px" }}>
                              {b.ship
                                ? `${b.ship.origin || "—"} → ${b.ship.dest || b.ship.destination || "—"}`
                                : <span style={{ color: "var(--red)" }}>not found</span>}
                            </td>
                            <td style={{ padding: "6px" }}>{b.ship?.mode || "—"}</td>
                            <td style={{ padding: "6px" }}>{b.ship?.status || "—"}</td>
                            <td className="mono" style={{ padding: "6px", textAlign: "right" }}>
                              {b.ship?.total_cost != null
                                ? `$${Number(b.ship.total_cost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : "—"}
                            </td>
                          </tr>
                        ))}
                        <tr style={{ borderTop: "2px solid var(--border)", fontWeight: 700 }}>
                          <td colSpan={4} style={{ padding: "6px", textAlign: "right" }}>Total Agreed</td>
                          <td className="mono" style={{ padding: "6px", textAlign: "right" }}>
                            ${sumAgreed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                        <tr style={{ fontWeight: 700, color: "var(--text2)" }}>
                          <td colSpan={4} style={{ padding: "6px", textAlign: "right" }}>Invoice Amount</td>
                          <td className="mono" style={{ padding: "6px", textAlign: "right" }}>
                            ${sumInvoiced.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving..." : isNew ? "Create Invoice" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
