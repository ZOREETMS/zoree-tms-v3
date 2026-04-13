import React from "react";
import OrderLinesEditor from "../OrderLinesEditor";
// API calls handled via props from parent (services layer)
import { STATUS_BADGES, STATUS_ROW_COLORS, SPOT_ROW_STYLE, EQUIPMENT_TYPES, DEMO_USERS } from "../../constants/orders";
import { fmt$, constraintBadges, SdField, cityZipLookup } from "../../utils/orderUtils.jsx";

export default function OrderDetailModal({
  order,
  orders,
  shipments,
  tab,
  onTabChange,
  editForm,
  onEditFormChange,
  editUser,
  onEditUserChange,
  editStatus,
  detailLines,
  onLinesChange,
  onSave,
  onSaveLines,
  onClose,
  onPlan,
  onUnplan,
  onCopy,
  onClearLines,
  busy,
  changeLog,
  itemMaster,
  carriers,
  toast,
  onClearHistory,
}) {
  if (!order) return null;

  const o = order;
  const w = typeof o.weight === "number" ? o.weight.toLocaleString() : o.weight;
  const sibs = orders.filter((x) => x.status === "Unplanned" && x.origin === o.origin && x.dest === o.dest && x.id !== o.id);
  const shipModeVal = o.ship_mode || o.shipMode;
  const histLog = changeLog || [];
  const relShips = shipments?.filter((sh) => o.shipment_id && sh.id === o.shipment_id) || [];

  return (
    <div className="modal-overlay" onClick={() => onClose()}>
      <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 16, width: 740, maxWidth: "95vw", maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(30,45,107,0.20)" }} onClick={(e) => e.stopPropagation()}>
        {/* Header with gradient + tabs */}
        <div style={{ background: "linear-gradient(135deg,#1a237e,#6366f1)", borderRadius: "16px 16px 0 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px 12px" }}>
            <div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,.6)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Order Details</div>
              <span style={{ color: "#fff", fontSize: 19, fontFamily: "'Syne',sans-serif", fontWeight: 700 }}>{o.id}</span>
            </div>
            <button onClick={() => onClose()} style={{ background: "none", border: "none", color: "rgba(255,255,255,.7)", fontSize: 22, cursor: "pointer", padding: "4px 8px", borderRadius: 6 }}>&#10005;</button>
          </div>
          <div style={{ display: "flex", padding: "0 22px", gap: 2 }}>
            {["view", "edit", "history"].map((t) => {
              const labels = { view: "Details", edit: "Edit", history: "History" };
              const icons = { view: "\ud83d\udccb", edit: "\u270f\ufe0f", history: "\ud83d\udd50" };
              const isActive = tab === t;
              return (
                <button key={t} onClick={() => { onTabChange(t); }} style={{
                  padding: "7px 18px", borderRadius: "8px 8px 0 0", border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  background: isActive ? "rgba(255,255,255,.95)" : "rgba(255,255,255,.25)",
                  color: isActive ? "#1a237e" : "rgba(255,255,255,.8)",
                }}>{icons[t]} {labels[t]}{t === "history" && histLog.length > 0 && <span style={{ background: "rgba(255,255,255,.3)", borderRadius: 10, padding: "0 6px", fontSize: 10, marginLeft: 4 }}>{histLog.length}</span>}</button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: 0, overflowY: "auto", flex: 1 }}>

          {/* ── VIEW TAB ── */}
          {tab === "view" && (<>
            {/* Status bar */}
            <div style={{ padding: "14px 24px", background: "#f8faff", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className={STATUS_BADGES[o.status] || "badge"}>{o.status}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text2)" }}>{o.customer || "\u2014"}</span>
                {o.no_contract_rate && <span style={{ fontSize: 9, fontWeight: 700, background: "#fee2e2", color: "#dc2626", border: "1px solid #fca5a5", padding: "2px 7px", borderRadius: 8 }}>{"\u26a0\ufe0f"} SPOT RATE</span>}
              </div>
              {o.shipment_id && <a href={`/shipments?id=${o.shipment_id}`} onClick={(e) => { e.preventDefault(); window.location.href = `/shipments?id=${o.shipment_id}`; }} className="mono" style={{ fontSize: 12, color: "var(--accent)", background: "var(--accent-glow)", padding: "4px 10px", borderRadius: 8, border: "1px solid rgba(59,130,246,.2)", textDecoration: "none", cursor: "pointer" }}>{"\u2192"} {o.shipment_id}</a>}
            </div>

            {/* Lane visual */}
            <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div><div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.8 }}>Origin</div><div style={{ fontWeight: 700, fontSize: 15, marginTop: 4 }}>{o.origin || "\u2014"}</div></div>
                <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 10px" }}>
                  <div style={{ flex: 1, height: 3, background: "linear-gradient(90deg,var(--accent),var(--accent2))", borderRadius: 2 }} />
                  <div style={{ margin: "0 8px", fontSize: 18 }}>{"\ud83d\ude9b"}</div>
                  <div style={{ flex: 1, height: 3, background: "linear-gradient(90deg,var(--accent2),var(--accent))", borderRadius: 2 }} />
                </div>
                <div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.8 }}>Destination</div><div style={{ fontWeight: 700, fontSize: 15, marginTop: 4 }}>{o.dest || "\u2014"}</div></div>
              </div>
            </div>

            {/* Details grid */}
            <div style={{ padding: "18px 24px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, borderBottom: "1px solid var(--border)" }}>
              <SdField icon={"\u2696\ufe0f"} label="Weight" value={w ? `${w} lbs` : null} />
              <SdField icon={"\ud83d\udd22"} label="Pieces" value={o.pieces} />
              <SdField icon={"\ud83c\udff7\ufe0f"} label="Commodity" value={o.commodity} />
              <SdField icon={"\ud83d\ude9b"} label="Ship Mode" value={shipModeVal ? <span style={{ display: "inline-block", background: shipModeVal === "TL" ? "#dbeafe" : "#d1fae5", color: shipModeVal === "TL" ? "#1d4ed8" : "#065f46", padding: "2px 10px", borderRadius: 6, fontWeight: 700, fontSize: 12 }}>{shipModeVal}</span> : <span style={{ color: "var(--text3)", fontStyle: "italic" }}>{"\u2014"} TMS selects {"\u2014"}</span>} />
              <SdField icon={"\ud83d\udcc5"} label="Ready Date" value={o.ready} />
              <SdField icon={"\ud83d\uddd3\ufe0f"} label="Due Date" value={o.due} />
              <SdField icon={"\ud83d\udd17"} label="Lane Peers" value={sibs.length > 0 ? `${sibs.length} eligible order(s)` : "No consolidation peers"} />
              {o.shipment_id && <SdField icon={"\ud83d\ude9a"} label="Shipment ID" value={<a href={`/shipments?id=${o.shipment_id}`} onClick={(e) => { e.preventDefault(); window.location.href = `/shipments?id=${o.shipment_id}`; }} className="mono" style={{ color: "var(--accent)", cursor: "pointer", textDecoration: "none" }}>{o.shipment_id} {"\u2197"}</a>} />}
              {o.ref_num && <SdField icon={"\ud83d\udccb"} label="Reference #" value={o.ref_num} />}
              {o.po_num && <SdField icon={"\ud83e\uddfe"} label="PO Number" value={o.po_num} />}
            </div>

            {/* Line Items */}
            <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>{"\ud83d\udce6"} Line Items{detailLines.length > 0 && <span style={{ fontSize: 10, fontWeight: 400, color: "var(--text3)", marginLeft: 4 }}>({detailLines.length})</span>}</div>
              <OrderLinesEditor orderId={o.id} lines={detailLines} onChange={onLinesChange} onSave={onSaveLines}
                onClear={() => { if (window.confirm("Clear all lines?")) { onClearLines(o.id); } }}
                busy={busy} mode="view" items={itemMaster} />
            </div>

            {/* Planning Constraints */}
            <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1 }}>{"\u2699\ufe0f"} Planning Constraints</div>
                {!["Delivered", "Cancelled"].includes(o.status) && <button className="btn btn-secondary btn-sm">{"\u270f\ufe0f"} Edit Constraints</button>}
              </div>
              {!(o.preferred_carrier || o.excluded_carrier || o.no_consolidate || o.hazmat) ? (
                <div style={{ fontSize: 13, color: "var(--text3)", padding: "10px 14px", background: "#f8faff", borderRadius: 8, border: "1px solid var(--border)" }}>No constraints set {"\u2014"} order will be auto-consolidated with cheapest rate</div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {o.preferred_carrier && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "rgba(59,130,246,.08)", border: "1px solid rgba(59,130,246,.2)", borderRadius: 10 }}><span>{"\ud83d\udccc"}</span><div><div style={{ fontSize: 11, color: "var(--text3)" }}>Preferred Carrier</div><div style={{ fontWeight: 600, fontSize: 13, color: "var(--accent)" }}>{o.preferred_carrier}</div></div></div>}
                  {o.excluded_carrier && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "rgba(107,114,128,.08)", border: "1px solid rgba(107,114,128,.2)", borderRadius: 10 }}><span>{"\u26d4"}</span><div><div style={{ fontSize: 11, color: "var(--text3)" }}>Excluded Carrier</div><div style={{ fontWeight: 600, fontSize: 13, color: "#6b7280" }}>{o.excluded_carrier}</div></div></div>}
                  {o.no_consolidate && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.2)", borderRadius: 10 }}><span>{"\ud83d\udeab"}</span><div><div style={{ fontSize: 11, color: "var(--text3)" }}>Consolidation</div><div style={{ fontWeight: 600, fontSize: 13, color: "var(--red)" }}>Solo load</div></div></div>}
                  {o.hazmat && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.2)", borderRadius: 10 }}><span>{"\u2622\ufe0f"}</span><div><div style={{ fontSize: 11, color: "var(--text3)" }}>Commodity</div><div style={{ fontWeight: 600, fontSize: 13, color: "var(--red)" }}>Hazmat</div></div></div>}
                </div>
              )}
            </div>

            {/* Related Shipments */}
            {relShips.length > 0 && (
              <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>{"\ud83d\ude9b"} Related Shipments ({relShips.length})</div>
                {relShips.map((sh) => (
                  <div key={sh.id} onClick={() => { onClose(); window.location.href = `/shipments?id=${sh.id}`; }} style={{ background: "#f0f9ff", border: "1px solid rgba(59,130,246,.2)", borderRadius: 10, padding: "12px 16px", marginBottom: 8, cursor: "pointer", transition: "all .15s" }} onMouseOver={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.boxShadow = "0 4px 16px rgba(59,130,246,.12)"; }} onMouseOut={(e) => { e.currentTarget.style.borderColor = "rgba(59,130,246,.2)"; e.currentTarget.style.boxShadow = "none"; }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <span className="mono" style={{ color: "var(--accent)", fontWeight: 700 }}>{sh.id}</span>
                      <span className={STATUS_BADGES[sh.status] || "badge"}>{sh.status}</span>
                      <span style={{ marginLeft: "auto", fontWeight: 800, color: "var(--green)" }}>${Number(sh.total_cost || 0).toLocaleString()}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 12 }}>
                      <div><span style={{ color: "var(--text3)" }}>Carrier: </span><strong>{sh.carrier}</strong></div>
                      <div><span style={{ color: "var(--text3)" }}>Pickup: </span>{sh.pickup_date || "\u2014"}</div>
                      <div><span style={{ color: "var(--text3)" }}>Delivery: </span>{sh.delivery_date || "\u2014"}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Notes */}
            {o.notes && (
              <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>{"\ud83d\udcdd"} Notes</div>
                <div style={{ fontSize: 13, color: "var(--text2)", background: "#f8faff", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px" }}>{o.notes}</div>
              </div>
            )}
          </>)}

          {/* ── EDIT TAB ── */}
          {tab === "edit" && (
            <div style={{ padding: "20px 24px" }}>
              {/* Edit-as user selector */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "#f0f4ff", borderRadius: 10, border: "1px solid rgba(59,130,246,.2)", marginBottom: 20 }}>
                <span style={{ fontSize: 16 }}>{"\ud83d\udc64"}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)" }}>Editing as:</span>
                <select value={editUser} onChange={(e) => onEditUserChange(e.target.value)} style={{ padding: "5px 10px", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: 12, fontFamily: "inherit", background: "#fff" }}>
                  {DEMO_USERS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
                <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: 4 }}>Changes will be attributed to this user in history</span>
              </div>

              {/* Order Identity */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>{"\ud83d\udccb"} Order Identity</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>Customer</label><input value={editForm.customer || ""} onChange={(e) => onEditFormChange((f) => ({ ...f, customer: e.target.value }))} style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>Status</label><select value={editForm.status || "Unplanned"} onChange={(e) => onEditFormChange((f) => ({ ...f, status: e.target.value }))} style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", background: "#fff", marginTop: 5 }}><option value="Unplanned">Unplanned</option><option value="Planned">Planned</option><option value="Consolidated">Consolidated</option><option value="On Hold">On Hold</option><option value="Planning Failed">Planning Failed</option><option value="Cancelled">Cancelled</option></select></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>Reference #</label><input value={editForm.refNum || ""} onChange={(e) => onEditFormChange((f) => ({ ...f, refNum: e.target.value }))} placeholder="e.g. PO-2026-001" style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>PO Number</label><input value={editForm.poNum || ""} onChange={(e) => onEditFormChange((f) => ({ ...f, poNum: e.target.value }))} placeholder="e.g. 4500123456" style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                </div>
              </div>

              {/* Lane */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>{"\ud83d\uddfa\ufe0f"} Lane</div>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>Origin City</label><input value={editForm.originCity || ""} onChange={(e) => onEditFormChange((f) => ({ ...f, originCity: e.target.value }))} placeholder="e.g. Chicago" style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>State</label><input value={editForm.originState || ""} onChange={(e) => onEditFormChange((f) => ({ ...f, originState: e.target.value }))} placeholder="IL" style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>ZIP</label><input value={editForm.originZip || ""} onChange={(e) => onEditFormChange((f) => ({ ...f, originZip: e.target.value }))} placeholder="60601" style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>Dest City</label><input value={editForm.destCity || ""} onChange={(e) => onEditFormChange((f) => ({ ...f, destCity: e.target.value }))} placeholder="e.g. Dallas" style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>State</label><input value={editForm.destState || ""} onChange={(e) => onEditFormChange((f) => ({ ...f, destState: e.target.value }))} placeholder="TX" style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>ZIP</label><input value={editForm.destZip || ""} onChange={(e) => onEditFormChange((f) => ({ ...f, destZip: e.target.value }))} placeholder="75201" style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                </div>
              </div>

              {/* Freight Details */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>{"\ud83d\udce6"} Freight Details</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>Weight (lbs)</label><input type="number" value={editForm.weight || ""} onChange={(e) => onEditFormChange((f) => ({ ...f, weight: e.target.value }))} style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>Pieces</label><input type="number" value={editForm.pieces || ""} onChange={(e) => onEditFormChange((f) => ({ ...f, pieces: e.target.value }))} style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>Mode</label><select value={editForm.shipMode || ""} onChange={(e) => onEditFormChange((f) => ({ ...f, shipMode: e.target.value }))} style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", background: "#fff", marginTop: 5 }}><option value="">— TMS selects —</option>{["TL", "LTL", "Intermodal", "Flatbed", "Reefer", "Partial", "Expedite", "Air Freight"].map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>Commodity</label><input value={editForm.commodity || ""} onChange={(e) => onEditFormChange((f) => ({ ...f, commodity: e.target.value }))} placeholder="e.g. Network Equipment" style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>Incoterms</label><input value={editForm.incoterms || ""} onChange={(e) => onEditFormChange((f) => ({ ...f, incoterms: e.target.value }))} placeholder="e.g. FOB, DAP, DDP" style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                </div>
              </div>

              {/* Dates */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>{"\ud83d\udcc5"} Dates</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>Ready Date</label><input type="date" value={editForm.ready || ""} onChange={(e) => onEditFormChange((f) => ({ ...f, ready: e.target.value }))} style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>Due Date</label><input type="date" value={editForm.due || ""} onChange={(e) => onEditFormChange((f) => ({ ...f, due: e.target.value }))} style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                </div>
              </div>

              {/* Notes */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>{"\ud83d\udcdd"} Notes</div>
                <textarea value={editForm.notes || ""} onChange={(e) => onEditFormChange((f) => ({ ...f, notes: e.target.value }))} rows={3} placeholder="Special instructions, references, internal notes..." style={{ width: "100%", padding: "9px 12px", border: "1.5px solid var(--border)", borderRadius: 9, fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
              </div>

              {/* Line Items in edit */}
              <div style={{ marginBottom: 16 }}>
                <OrderLinesEditor orderId={o.id} lines={detailLines} onChange={onLinesChange} onSave={onSaveLines}
                  onClear={() => { if (window.confirm("Clear all lines?")) { onClearLines(o.id); } }}
                  busy={busy} items={itemMaster} />
              </div>
            </div>
          )}

          {/* ── HISTORY TAB ── */}
          {tab === "history" && (
            <div style={{ padding: "20px 24px" }}>
              {histLog.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text3)" }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>{"\ud83d\udccb"}</div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>No changes recorded yet</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>Edits made via the Edit tab will appear here with full field-level detail.</div>
                </div>
              ) : (<>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{histLog.length} change set{histLog.length !== 1 ? "s" : ""} recorded</div>
                  <button onClick={() => onClearHistory && onClearHistory()} style={{ padding: "4px 10px", background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.2)", borderRadius: 7, fontSize: 11, color: "var(--red)", cursor: "pointer", fontFamily: "inherit" }}>{"\ud83d\uddd1"} Clear History</button>
                </div>
                {histLog.map((entry, i) => {
                  const isPlan = entry.type === "plan"; const isUnassign = entry.type === "unassign";
                  const userColor = entry.user?.includes("System") ? "#6b7280" : "#1d4ed8";
                  const headerBg = isPlan ? "#f0f9ff" : isUnassign ? "#fff7ed" : "#f8faff";
                  const icon = isPlan ? "\ud83d\ude9a" : isUnassign ? "\ud83d\udd13" : "\ud83d\udc64";
                  const typeLabel = isPlan ? "Planned \u2192 Shipment" : isUnassign ? "Unassigned from Shipment" : `${entry.changes.length} field${entry.changes.length !== 1 ? "s" : ""} changed`;
                  const typeBg = isPlan ? "rgba(59,130,246,.12)" : isUnassign ? "rgba(245,158,11,.12)" : "rgba(59,130,246,.1)";
                  const typeColor = isPlan ? "#1d4ed8" : isUnassign ? "#b45309" : "var(--accent)";
                  return (
                    <div key={i} style={{ border: `1.5px solid ${isPlan ? "rgba(59,130,246,.25)" : isUnassign ? "rgba(245,158,11,.25)" : "var(--border)"}`, borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: headerBg, borderBottom: "1px solid var(--border)" }}>
                        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#1a237e,#6366f1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>{icon}</div>
                        <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 13, color: userColor }}>{entry.user || "System"}</div><div style={{ fontSize: 11, color: "var(--text3)" }}>{entry.ts}</div></div>
                        <div style={{ fontSize: 11, fontWeight: 600, background: typeBg, color: typeColor, padding: "3px 10px", borderRadius: 10 }}>{typeLabel}</div>
                      </div>
                      <div style={{ padding: "8px 0" }}>
                        {entry.changes.map((ch, j) => (
                          <div key={j} style={{ display: "grid", gridTemplateColumns: "120px 1fr 20px 1fr", gap: 8, alignItems: "center", padding: "7px 14px", borderBottom: "1px solid var(--border)" }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.4 }}>{ch.label}</div>
                            <div style={{ fontSize: 12, background: "#fee2e2", color: "#7f1d1d", padding: "4px 10px", borderRadius: 7, textDecoration: "line-through", opacity: 0.8 }}>{ch.old || "\u2014"}</div>
                            <div style={{ textAlign: "center", color: "var(--text3)", fontSize: 12 }}>{"\u2192"}</div>
                            <div style={{ fontSize: 12, background: "#dcfce7", color: "#14532d", padding: "4px 10px", borderRadius: 7, fontWeight: 600 }}>{ch.new || "\u2014"}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </>)}
            </div>
          )}
        </div>

        {/* Footer */}
        {tab === "view" && (
          <div style={{ padding: "14px 24px", background: "#f8faff", display: "flex", gap: 8, borderRadius: "0 0 16px 16px", borderTop: "1.5px solid var(--border)" }}>
            {o.status === "Unplanned" && <button className="btn btn-primary btn-sm" onClick={() => onPlan(o.id)} style={{ background: "linear-gradient(135deg,#059669,#10b981)", border: "none" }}>{"\u26a1"} Plan This Order</button>}
            {(o.status === "Planned" || o.status === "Consolidated") && <button className="btn btn-sm" style={{ background: "#dc2626", color: "#fff", border: "none" }} onClick={() => onUnplan(o.id)}>{"\ud83d\udd13"} Unplan</button>}
            <button className="btn btn-secondary btn-sm" onClick={() => onTabChange("edit")}>{"\u270f\ufe0f"} Edit Order</button>
            {onCopy && <button className="btn btn-secondary btn-sm" onClick={() => onCopy(o.id)}>{"\ud83d\udccb"} Copy Order</button>}
            {histLog.length > 0 && <button className="btn btn-secondary btn-sm" onClick={() => onTabChange("history")} style={{ marginLeft: "auto" }}>{"\ud83d\udd50"} History ({histLog.length})</button>}
          </div>
        )}
        {tab === "edit" && (
          <div style={{ padding: "14px 22px", background: "#f8faff", borderTop: "1.5px solid var(--border)", borderRadius: "0 0 16px 16px", display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: editStatus ? "var(--text3)" : "transparent", flex: 1 }}>{editStatus || "."}</span>
            <button className="btn btn-secondary" onClick={() => onTabChange("view")}>Cancel</button>
            <button className="btn btn-primary" onClick={onSave} disabled={busy} style={{ background: "linear-gradient(135deg,#1a237e,#6366f1)", border: "none" }}>{"\ud83d\udcbe"} Save Changes</button>
          </div>
        )}
        {tab === "history" && (
          <div style={{ padding: "14px 22px", background: "#f8faff", borderTop: "1.5px solid var(--border)", borderRadius: "0 0 16px 16px", display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn btn-secondary" onClick={() => onTabChange("view")}>Back to Details</button>
          </div>
        )}
      </div>
    </div>
  );
}
