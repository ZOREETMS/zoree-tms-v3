import React from "react";
import OrderLinesEditor from "../OrderLinesEditor";
import LocationFieldsEditor from "../LocationFieldsEditor";
import { INCOTERMS } from "../../constants/incoterms";   // QA #154

export default function NewOrderModal({ show, form, onFormChange, lines, onLinesChange, onSubmit, onClose, carriers, busy, itemMaster }) {
  if (!show) return null;

  const upd = (k, v) => onFormChange((f) => ({ ...f, [k]: v }));
  const carrierNames = carriers.map((c) => c.name).filter(Boolean).sort();
  const inputSt = { width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" };
  const labelSt = { fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ width: 620, maxHeight: "92vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>New Order</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ overflowY: "auto", flex: 1 }}>
          {/* Order Identity — customer + references (parity with Edit tab) */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelSt}>Customer</label>
            <input value={form.customer} onChange={(e) => upd("customer", e.target.value)} placeholder="Cisco Systems" style={inputSt} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <label style={labelSt}>Reference # <span style={{ fontSize: 10, color: "var(--text3)", fontWeight: 400 }}>(optional)</span></label>
              <input value={form.refNum || ""} onChange={(e) => upd("refNum", e.target.value)} placeholder="e.g. PO-2026-001" style={inputSt} />
            </div>
            <div>
              <label style={labelSt}>PO Number <span style={{ fontSize: 10, color: "var(--text3)", fontWeight: 400 }}>(optional)</span></label>
              <input value={form.poNum || ""} onChange={(e) => upd("poNum", e.target.value)} placeholder="e.g. 4500123456" style={inputSt} />
            </div>
          </div>
          {/* Ship From / Ship To — shared editor, canonical shipFrom /
              shipTo shape. No adapter needed — the parent
              (OrdersPage) owns the same shape. */}
          <div style={{ marginBottom: 14 }}>
            <LocationFieldsEditor
              label="Ship From"
              value={form.shipFrom}
              onChange={(next) => onFormChange((f) => ({ ...f, shipFrom: next }))}
              namePlaceholder="Location Name (e.g. Chicago DC)"
              cityPlaceholder="City (e.g. Chicago)"
              enableSearch
              searchSource="oms"
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <LocationFieldsEditor
              label="Ship To"
              value={form.shipTo}
              onChange={(next) => onFormChange((f) => ({ ...f, shipTo: next }))}
              namePlaceholder="Location Name (e.g. Dallas Warehouse)"
              cityPlaceholder="City (e.g. Dallas)"
              enableSearch
              searchSource="oms"
            />
          </div>
          {/* Freight Details — parity with Edit tab.
              QA #134: switch from 4 cramped columns to 2×2 so the
              Mode and Service Level <select>s have room for their
              labels (e.g. "— TMS selects —", "White Glove") without
              clipping inside the 620px modal. `minWidth: 0` lets
              the inputs shrink with the grid track instead of
              forcing an overflow. */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div style={{ minWidth: 0 }}>
              <label style={labelSt}>Weight (lbs)</label>
              <input type="number" value={form.weight || ""} onChange={(e) => upd("weight", e.target.value)} placeholder="Auto" style={inputSt} />
            </div>
            <div style={{ minWidth: 0 }}>
              <label style={labelSt}>Pieces</label>
              <input type="number" value={form.pieces || ""} onChange={(e) => upd("pieces", e.target.value)} placeholder="Auto" style={inputSt} />
            </div>
            <div style={{ minWidth: 0 }}>
              <label style={labelSt}>Mode</label>
              <select value={form.shipMode || ""} onChange={(e) => upd("shipMode", e.target.value)} style={{ ...inputSt, background: "#fff" }}>
                <option value="">— TMS selects —</option>
                {["TL","LTL","Intermodal","Flatbed","Reefer","Parcel","Expedite","Air Freight"].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div style={{ minWidth: 0 }}>
              <label style={labelSt}>Service Level</label>
              <select value={form.serviceLevel || ""} onChange={(e) => upd("serviceLevel", e.target.value)} style={{ ...inputSt, background: "#fff" }}>
                <option value="">— TMS selects —</option>
                {["Standard","Guaranteed","Expedited","Economy","White Glove"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          {/* Commodity + Incoterms */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div><label style={labelSt}>Commodity</label><input value={form.commodity} onChange={(e) => upd("commodity", e.target.value)} placeholder="Network Equipment" style={inputSt} /></div>
            <div><label style={labelSt}>Incoterms <span style={{ fontSize: 10, color: "var(--text3)", fontWeight: 400 }}>(optional)</span></label>
              <select value={form.incoterms} onChange={(e) => upd("incoterms", e.target.value)} style={{ ...inputSt, background: "#fff" }}>
                <option value="">— Select —</option>
                {/* QA #154: canonical 4-option list shared with the OMS
                    HTML and mobile app — see constants/incoterms.js. */}
                {INCOTERMS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          {/* Dates */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div><label style={labelSt}>Ready Date</label><input type="date" value={form.ready} onChange={(e) => upd("ready", e.target.value)} style={inputSt} /></div>
            <div><label style={labelSt}>Due Date</label><input type="date" value={form.due} onChange={(e) => upd("due", e.target.value)} style={inputSt} /></div>
          </div>
          {/* Notes */}
          <div style={{ marginBottom: 18 }}>
            <label style={labelSt}>Notes <span style={{ fontSize: 10, color: "var(--text3)", fontWeight: 400 }}>(optional)</span></label>
            <textarea value={form.notes || ""} onChange={(e) => upd("notes", e.target.value)} rows={3} placeholder="Special instructions, references, internal notes..." style={{ ...inputSt, resize: "vertical", fontFamily: "inherit" }} />
          </div>
          {/* Line Items */}
          <OrderLinesEditor orderId="new" lines={lines} onChange={onLinesChange} onSave={() => {}} onClear={() => onLinesChange([])} busy={false} items={itemMaster} showSaveButtons={false} />
          {/* Planning Constraints */}
          <div style={{ marginTop: 14, padding: "14px 16px", background: "#f8faff", borderRadius: 10, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>⚙️ Planning Constraints <span style={{ fontWeight: 400, fontSize: 10, letterSpacing: 0 }}>(optional)</span></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 10 }}>
              <div><label style={labelSt}>Preferred Carrier</label>
                <select value={form.preferredCarrier} onChange={(e) => upd("preferredCarrier", e.target.value)} style={{ ...inputSt, background: "#fff" }}>
                  <option value="">No preference (auto-select cheapest)</option>
                  {carrierNames.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div><label style={labelSt}>Excluded Carrier</label>
                <select value={form.excludedCarrier} onChange={(e) => upd("excludedCarrier", e.target.value)} style={{ ...inputSt, background: "#fff" }}>
                  <option value="">None</option>
                  {carrierNames.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13, fontWeight: 400, color: "var(--text)" }}>
                <input type="checkbox" checked={form.noConsolidate} onChange={(e) => upd("noConsolidate", e.target.checked)} style={{ width: 16, height: 16, marginTop: 2, accentColor: "var(--accent)" }} />
                <div><div style={{ fontWeight: 600 }}>Do not consolidate</div><div style={{ fontSize: 11, color: "var(--text3)", marginTop: 1 }}>This order must ship as a standalone load — it will not be grouped with other orders on the same lane</div></div>
              </label>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13, fontWeight: 400, color: "var(--text)" }}>
                <input type="checkbox" checked={form.dedicatedEquip} onChange={(e) => upd("dedicatedEquip", e.target.checked)} style={{ width: 16, height: 16, marginTop: 2, accentColor: "var(--accent)" }} />
                <div><div style={{ fontWeight: 600 }}>Dedicated equipment required</div><div style={{ fontSize: 11, color: "var(--text3)", marginTop: 1 }}>Requires a dedicated trailer — cannot share equipment with other shipments</div></div>
              </label>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13, fontWeight: 400, color: "var(--text)" }}>
                <input type="checkbox" checked={form.hazmat} onChange={(e) => upd("hazmat", e.target.checked)} style={{ width: 16, height: 16, marginTop: 2, accentColor: "var(--accent)" }} />
                <div><div style={{ fontWeight: 600 }}>Hazmat / Restricted commodity</div><div style={{ fontSize: 11, color: "var(--text3)", marginTop: 1 }}>Requires hazmat-certified carrier and cannot be consolidated with non-hazmat freight</div></div>
              </label>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onSubmit} disabled={busy}>Create Order</button>
        </div>
      </div>
    </div>
  );
}
