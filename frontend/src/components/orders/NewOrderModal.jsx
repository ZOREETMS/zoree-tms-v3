import React from "react";
import OrderLinesEditor from "../OrderLinesEditor";

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
          {/* Customer */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelSt}>Customer</label>
            <input value={form.customer} onChange={(e) => upd("customer", e.target.value)} placeholder="Cisco Systems" style={inputSt} />
          </div>
          {/* Origin */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelSt}>Origin</label>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
              <input value={form.originCity} onChange={(e) => upd("originCity", e.target.value)} placeholder="City (e.g. Chicago)" style={inputSt} />
              <input value={form.originState} onChange={(e) => upd("originState", e.target.value)} placeholder="ST" maxLength={2} style={{ ...inputSt, textTransform: "uppercase" }} />
              <input value={form.originZip} onChange={(e) => upd("originZip", e.target.value)} placeholder="ZIP" maxLength={5} style={inputSt} />
            </div>
          </div>
          {/* Destination */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelSt}>Destination</label>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
              <input value={form.destCity} onChange={(e) => upd("destCity", e.target.value)} placeholder="City (e.g. Dallas)" style={inputSt} />
              <input value={form.destState} onChange={(e) => upd("destState", e.target.value)} placeholder="ST" maxLength={2} style={{ ...inputSt, textTransform: "uppercase" }} />
              <input value={form.destZip} onChange={(e) => upd("destZip", e.target.value)} placeholder="ZIP" maxLength={5} style={inputSt} />
            </div>
          </div>
          {/* Commodity + Incoterms */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div><label style={labelSt}>Commodity</label><input value={form.commodity} onChange={(e) => upd("commodity", e.target.value)} placeholder="Network Equipment" style={inputSt} /></div>
            <div><label style={labelSt}>Incoterms <span style={{ fontSize: 10, color: "var(--text3)", fontWeight: 400 }}>(optional)</span></label>
              <select value={form.incoterms} onChange={(e) => upd("incoterms", e.target.value)} style={{ ...inputSt, background: "#fff" }}>
                <option value="">— Select —</option>
                {["EXW","FCA","CPT","CIP","DAP","DPU","DDP","FAS","FOB","CFR","CIF"].map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          {/* Dates */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
            <div><label style={labelSt}>Ready Date</label><input type="date" value={form.ready} onChange={(e) => upd("ready", e.target.value)} style={inputSt} /></div>
            <div><label style={labelSt}>Due Date</label><input type="date" value={form.due} onChange={(e) => upd("due", e.target.value)} style={inputSt} /></div>
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
