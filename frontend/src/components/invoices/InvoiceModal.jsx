import { useState, useEffect } from "react";
import { INVOICE_STATUSES, PAYMENT_TERMS, emptyInvoice } from "../../types/invoice";
import { generateInvoiceNum, computeDueDate } from "../../services/invoiceService";

export default function InvoiceModal({
  invoice,
  shipments,
  carriers,
  onSave,
  onClose,
  busy,
}) {
  const isNew = !invoice?.num;
  const [form, setForm] = useState(() => {
    if (invoice) return { ...invoice };
    const empty = emptyInvoice();
    empty.num = generateInvoiceNum();
    empty.due = computeDueDate(empty.date, "NET30");
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
                <label>Shipment</label>
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
