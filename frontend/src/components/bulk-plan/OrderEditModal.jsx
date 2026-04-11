import { useState, useEffect } from "react";
import { DbApi, OrdersApi } from "../../lib/api";
import OrderLinesEditor from "../OrderLinesEditor";

/**
 * Order edit modal for Bulk Plan page — matches the Orders page edit form.
 * Split city/state/zip, freight details, dates, notes.
 */
export default function OrderEditModal({ isOpen, order, items = [], onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lines, setLines] = useState([]);

  useEffect(() => {
    if (order) {
      const op = parseCity(order.origin || "");
      const dp = parseCity(order.dest || order.destination || "");
      setForm({
        customer: order.customer || "",
        status: order.status || "Unplanned",
        refNum: order.ref_num || order.refNum || "",
        poNum: order.po_num || order.poNum || "",
        originCity: op.city,
        originState: op.state,
        originZip: order.origin_zip || op.zip || "",
        destCity: dp.city,
        destState: dp.state,
        destZip: order.dest_zip || dp.zip || "",
        weight: order.weight || "",
        pieces: order.pieces || "",
        shipMode: order.ship_mode || order.shipMode || "",
        commodity: order.commodity || "",
        incoterms: order.incoterms || "",
        ready: order.ready || order.pickup_date || order.ready_date || "",
        due: order.due || order.delivery_date || order.due_date || "",
        notes: order.notes || "",
      });
      setError("");
      // Fetch line items
      OrdersApi.full(order.id)
        .then((full) => setLines(Array.isArray(full?.lines) ? full.lines : []))
        .catch(() => setLines([]));
    }
  }, [order]);

  if (!isOpen || !order) return null;

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    setBusy(true);
    setError("");
    try {
      const f = form;
      const newOrigin = [f.originCity, f.originState?.toUpperCase()].filter(Boolean).join(", ") + (f.originZip ? " " + f.originZip : "");
      const newDest = [f.destCity, f.destState?.toUpperCase()].filter(Boolean).join(", ") + (f.destZip ? " " + f.destZip : "");
      const patch = {
        customer: f.customer || null,
        status: f.status || null,
        origin: newOrigin || null,
        dest: newDest || null,
        weight: Number(f.weight) || 0,
        pieces: Number(f.pieces) || 0,
        commodity: f.commodity || null,
        ready: f.ready || null,
        due: f.due || null,
        notes: f.notes || null,
      };
      if (f.originZip) patch.origin_zip = f.originZip;
      if (f.destZip) patch.dest_zip = f.destZip;

      // Auto-compute weight/pieces from line items if present
      if (lines.length > 0) {
        const linesWeight = lines.reduce((s, l) => s + (parseFloat(l.total_weight || l.totalWt || 0)), 0);
        const linesPieces = lines.reduce((s, l) => s + (parseInt(l.qty_ordered || l.qty || 0)), 0);
        if (linesWeight > 0) patch.weight = linesWeight;
        if (linesPieces > 0) patch.pieces = linesPieces;
      }

      await DbApi.patch("orders", order.id, patch);
      // Save line items
      if (lines.length > 0) {
        await OrdersApi.saveLines(order.id, lines.map((ln, idx) => ({
          ...ln, line_num: idx + 1,
        })));
      }
      if (onSaved) await onSaved(order.id);
      onClose();
    } catch (e) {
      setError(e.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = { width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 };

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: 620 }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header" style={{ background: "linear-gradient(135deg,#1a237e,#6366f1)" }}>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,.6)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
              Order Details
            </div>
            <span className="modal-title" style={{ color: "#fff" }}>{order.id}</span>
          </div>
          <button className="modal-close" onClick={onClose} style={{ color: "rgba(255,255,255,.7)", fontSize: 22 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ overflowY: "auto", maxHeight: "70vh" }}>
          <div className="modal-body" style={{ padding: 20 }}>
            {error && (
              <div style={{ padding: "8px 12px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, fontSize: 12, color: "#991b1b", marginBottom: 14 }}>
                {error}
              </div>
            )}

            {/* Order Identity */}
            <SectionLabel icon="📋" label="Order Identity" />
            <div className="form-grid" style={{ gap: 12, marginBottom: 16 }}>
              <FormField label="Customer" value={form.customer} onChange={(v) => set("customer", v)} style={inputStyle} />
              <div>
                <label style={labelStyle}>Status</label>
                <select value={form.status} onChange={(e) => set("status", e.target.value)} style={{ ...inputStyle, background: "#fff" }}>
                  <option value="Unplanned">Unplanned</option>
                  <option value="Planned">Planned</option>
                  <option value="Consolidated">Consolidated</option>
                  <option value="On Hold">On Hold</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </div>
            </div>
            <div className="form-grid" style={{ gap: 12, marginBottom: 16 }}>
              <FormField label="Reference #" value={form.refNum} onChange={(v) => set("refNum", v)} placeholder="e.g. PO-2026-001" style={inputStyle} />
              <FormField label="PO Number" value={form.poNum} onChange={(v) => set("poNum", v)} placeholder="e.g. 4500123456" style={inputStyle} />
            </div>

            {/* Lane */}
            <SectionLabel icon="🚛" label="Lane" />
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.6fr 0.8fr", gap: 10, marginBottom: 10 }}>
              <FormField label="Origin City" value={form.originCity} onChange={(v) => set("originCity", v)} style={inputStyle} />
              <FormField label="State" value={form.originState} onChange={(v) => set("originState", v)} placeholder="IL" style={inputStyle} />
              <FormField label="ZIP" value={form.originZip} onChange={(v) => set("originZip", v)} placeholder="60601" style={inputStyle} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.6fr 0.8fr", gap: 10, marginBottom: 16 }}>
              <FormField label="Dest City" value={form.destCity} onChange={(v) => set("destCity", v)} style={inputStyle} />
              <FormField label="State" value={form.destState} onChange={(v) => set("destState", v)} placeholder="TX" style={inputStyle} />
              <FormField label="ZIP" value={form.destZip} onChange={(v) => set("destZip", v)} placeholder="75201" style={inputStyle} />
            </div>

            {/* Freight Details */}
            <SectionLabel icon="📦" label="Freight Details" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
              <FormField label="Weight (lbs)" value={form.weight} onChange={(v) => set("weight", v)} type="number" style={inputStyle} />
              <FormField label="Pieces" value={form.pieces} onChange={(v) => set("pieces", v)} type="number" style={inputStyle} />
              <div>
                <label style={labelStyle}>Mode</label>
                <select value={form.shipMode} onChange={(e) => set("shipMode", e.target.value)} style={{ ...inputStyle, background: "#fff" }}>
                  <option value="">— TMS Selects —</option>
                  <option value="TL">TL (Truckload)</option>
                  <option value="LTL">LTL</option>
                  <option value="Partial">Partial TL</option>
                  <option value="Intermodal">Intermodal</option>
                  <option value="Air">Air</option>
                </select>
              </div>
            </div>
            <div className="form-grid" style={{ gap: 12, marginBottom: 16 }}>
              <FormField label="Commodity" value={form.commodity} onChange={(v) => set("commodity", v)} style={inputStyle} />
              <FormField label="Incoterms" value={form.incoterms} onChange={(v) => set("incoterms", v)} placeholder="e.g. FOB, DAP, DDP" style={inputStyle} />
            </div>

            {/* Dates */}
            <SectionLabel icon="📅" label="Dates" />
            <div className="form-grid" style={{ gap: 12, marginBottom: 16 }}>
              <FormField label="Ready Date" value={form.ready} onChange={(v) => set("ready", v)} type="date" style={inputStyle} />
              <FormField label="Due Date" value={form.due} onChange={(v) => set("due", v)} type="date" style={inputStyle} />
            </div>

            {/* Line Items */}
            <SectionLabel icon="📦" label={`Line Items${lines.length > 0 ? ` (${lines.length})` : ""}`} />
            <div style={{ marginBottom: 16 }}>
              <OrderLinesEditor
                orderId={order.id}
                lines={lines}
                onChange={setLines}
                onSave={() => {}}
                onClear={() => setLines([])}
                busy={busy}
                mode="edit"
                items={items}
                showSaveButtons={false}
              />
            </div>

            {/* Notes */}
            <SectionLabel icon="📝" label="Notes" />
            <textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
              placeholder="Special instructions, references, internal notes..."
              style={{ ...inputStyle, resize: "vertical", marginTop: 0 }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={busy}>
            💾 {busy ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

const labelStyle = { fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" };

function SectionLabel({ icon, label }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
      <span>{icon}</span> {label}
    </div>
  );
}

function FormField({ label, value, onChange, type = "text", placeholder, style }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type={type}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={style}
      />
    </div>
  );
}

/* ── Helpers ── */

function parseCity(str) {
  if (!str) return { city: "", state: "", zip: "" };
  let s = str;
  let zip = "";
  const m = s.match(/(\d{5})/);
  if (m) {
    zip = m[1];
    s = s.replace(m[1], "").replace(/,?\s*$/, "").trim();
  }
  const parts = s.split(",");
  return { city: (parts[0] || "").trim(), state: (parts[1] || "").trim(), zip };
}
