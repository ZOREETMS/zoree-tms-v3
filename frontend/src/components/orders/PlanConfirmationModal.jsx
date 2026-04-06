import React from "react";
import { EQUIPMENT_TYPES, DEFAULT_EQUIP } from "../../constants/orders";
import { fmt$, calcDates } from "../../utils/orderUtils.jsx";

function ShipmentGroupCard({ group, groupIdx, onSelectQuote }) {
  const { lane, orders, quotes, selectedIdx, equipType, maxWt, util } = group;
  const equip = EQUIPMENT_TYPES[equipType] || EQUIPMENT_TYPES[DEFAULT_EQUIP];
  const utilColor = util >= 90 ? "var(--green)" : util >= 70 ? "var(--yellow)" : "var(--accent)";
  const readyDate = orders?.map((s) => s.ready).filter(Boolean).sort().reverse()[0] || "";
  const earliestDue = orders?.map((s) => s.due).filter(Boolean).sort()[0] || "";

  return (
    <div style={{ padding: "14px 16px", background: "#fff", border: "1.5px solid rgba(99,102,241,.2)", borderRadius: 12, marginBottom: 12 }}>
      {/* Lane header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: "50%", background: "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 13 }}>{groupIdx + 1}</span>
          <span style={{ fontWeight: 700, fontSize: 13 }}>{(lane.origin || "").split(",")[0]} → {(lane.destination || "").split(",")[0]}</span>
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: utilColor }}>{util}% Full</span>
      </div>
      {/* Orders in shipment */}
      {orders?.map((s) => (
        <div key={s.id} style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--text2)", padding: "2px 0 2px 36px" }}>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>{s.id}</span>
          <span>{s.customer}</span>
          <span>{s.commodity || "General"}</span>
          <span style={{ marginLeft: "auto", fontWeight: 600 }}>{Number(s.weight || 0).toLocaleString()} lbs</span>
        </div>
      ))}
      {/* Weight bar */}
      <div style={{ marginTop: 10, paddingLeft: 36 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: "var(--text3)" }}>Weight</span>
          <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: utilColor, fontWeight: 600 }}>{lane.totalWeight.toLocaleString()} / {maxWt.toLocaleString()} lbs</span>
        </div>
        <div style={{ background: "#f1f5f9", borderRadius: 5, height: 6 }}>
          <div style={{ width: `${Math.min(100, util)}%`, background: utilColor, borderRadius: 5, height: 6 }} />
        </div>
        {lane.totalWeight > maxWt && <div style={{ fontSize: 10, color: "var(--red)", marginTop: 3, fontWeight: 600 }}>⚠️ Exceeds weight limit by {(lane.totalWeight - maxWt).toLocaleString()} lbs</div>}
      </div>

      {/* Rate options */}
      <div style={{ marginTop: 14 }}>
        {quotes.map((quote, i) => {
          if (!(quote.transitDays > 0)) return null;
          const isSelected = selectedIdx === i;
          const isExp = (quote.serviceLevel || "").toLowerCase().includes("express");
          const svcTag = isExp ? "EXP" : "STD";
          const rMode = quote.mode || "TL";
          const dates = calcDates(quote, earliestDue, readyDate);
          const isPref = quote.preferred;
          const isCzarlite = quote.czarlite || rMode === "LTL";
          return (
            <div key={i}
              onClick={() => onSelectQuote(groupIdx, i)}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", marginBottom: 4,
                borderRadius: 8, cursor: "pointer",
                border: isSelected ? "1px solid rgba(16,185,129,.2)" : "1px solid var(--border)",
                background: isSelected ? "rgba(16,185,129,.06)" : "var(--bg4)",
              }}
            >
              <input type="radio" name={`plan-rate-${groupIdx}`} checked={isSelected} readOnly style={{ margin: 0, accentColor: "var(--accent)" }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: isSelected ? 700 : 500, fontSize: 12 }}>{quote.carrier}</span>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: rMode === "LTL" ? "rgba(99,102,241,.12)" : "rgba(16,185,129,.12)", color: rMode === "LTL" ? "#4f46e5" : "#059669" }}>{rMode}</span>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: isExp ? "rgba(124,58,237,.12)" : "rgba(107,114,128,.1)", color: isExp ? "#7c3aed" : "#6b7280" }}>{svcTag}{isExp ? " 🚛🚛" : ""}</span>
                  {isPref && <span style={{ fontSize: 9, background: "rgba(59,130,246,.1)", color: "var(--accent)", border: "1px solid rgba(59,130,246,.2)", padding: "1px 6px", borderRadius: 8, fontWeight: 700 }}>⭐ PREF</span>}
                  {isSelected && <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: "rgba(16,185,129,.12)", color: "#059669" }}>✓ SELECTED</span>}
                  {isCzarlite && <span style={{ fontSize: 9, background: "rgba(99,102,241,.1)", color: "#4f46e5", padding: "1px 6px", borderRadius: 8, fontWeight: 600 }}>CZARLITE</span>}
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 4, fontSize: 10, color: "var(--text3)", whiteSpace: "nowrap", flexWrap: "nowrap", overflow: "hidden" }}>
                  <span>🚚 {dates.transit}D</span>
                  {quote.miles && <span>📏 {quote.miles.toLocaleString()} mi{quote.pcmilerMiles ? " (PC*MILER)" : ""}</span>}
                  <span>📦 {dates.pickup}</span>
                  <span>🏁 {dates.delivery}</span>
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 2, fontSize: 9, color: "var(--text3)" }}>
                  <span>Base: {fmt$(quote.czarBaseGross || quote.czarBase || 0)}</span>
                  <span>Fuel: {fmt$(quote.fscCharge || 0)}</span>
                  {(quote.accessorialCharge || 0) > 0 && <span>Acc: {fmt$(quote.accessorialCharge)}</span>}
                </div>
                {dates.warning && <div style={{ marginTop: 3, fontSize: 9, color: "#dc2626", fontWeight: 600 }}>⚠️ {dates.warning}</div>}
              </div>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: isSelected ? 800 : 600, fontSize: 13, color: isSelected ? "var(--green)" : "var(--text2)" }}>{fmt$(quote.totalCharge)}</span>
            </div>
          );
        })}
        {quotes.filter((q) => q.transitDays > 0).length === 0 && (
          <div style={{ textAlign: "center", padding: 20, color: "var(--text3)", fontSize: 12 }}>
            No carrier quotes with valid transit data. Configure transit_days in rate table or enable CarrierConnect.
          </div>
        )}
      </div>
    </div>
  );
}

export default function PlanConfirmationModal({ planModal, onModalChange, onConfirm, onClose }) {
  if (!planModal) return null;

  const { lane, siblings, busy, error, maxWt, util, loadDuration, equipType, shipmentGroups } = planModal;
  // Use shipmentGroups if available (split mode), else single group from legacy fields
  const groups = shipmentGroups && shipmentGroups.length > 0
    ? shipmentGroups
    : [{ lane, orders: siblings, quotes: planModal.quotes || [], selectedIdx: planModal.selectedIdx || 0, bestQuote: planModal.bestQuote, equipType, maxWt, util }];

  const totalShipments = groups.length;
  const totalOrders = groups.reduce((s, g) => s + (g.lane?.orderIds?.length || 0), 0);
  const hasAnyQuotes = groups.some((g) => g.quotes?.some((q) => q.transitDays > 0));

  function handleSelectQuote(groupIdx, quoteIdx) {
    onModalChange((prev) => {
      if (!prev) return null;
      const updated = [...(prev.shipmentGroups || groups)];
      updated[groupIdx] = { ...updated[groupIdx], selectedIdx: quoteIdx };
      return { ...prev, shipmentGroups: updated };
    });
  }

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal-card" style={{ width: 680, maxHeight: "92vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>🔒 Plan {totalOrders} Order{totalOrders !== 1 ? "s" : ""} → {totalShipments} Shipment{totalShipments !== 1 ? "s" : ""}</h3>
          <button className="modal-close" onClick={() => !busy && onClose()}>✕</button>
        </div>
        <div className="modal-body" style={{ overflowY: "auto", flex: 1 }}>
          {/* Equipment Selector (applies to first/all groups) */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "#f0f4ff", borderRadius: 10, marginBottom: 14, border: "1px solid rgba(59,130,246,.15)" }}>
            <span style={{ fontSize: 14 }}>🚛</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)" }}>Equipment:</span>
            <select
              value={groups[0]?.equipType || DEFAULT_EQUIP}
              onChange={(e) => {
                const newEquip = e.target.value;
                const newMax = EQUIPMENT_TYPES[newEquip].maxWeight;
                onModalChange((p) => {
                  if (!p) return null;
                  const updated = (p.shipmentGroups || groups).map((g) => ({
                    ...g,
                    equipType: newEquip,
                    maxWt: newMax,
                    util: Math.round((g.lane.totalWeight / newMax) * 100),
                  }));
                  return { ...p, equipType: newEquip, maxWt: newMax, util: Math.round((lane.totalWeight / newMax) * 100), shipmentGroups: updated };
                });
              }}
              style={{ padding: "4px 9px", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: 12, fontFamily: "inherit", background: "#fff" }}
            >
              {Object.entries(EQUIPMENT_TYPES).map(([name, eq]) => (
                <option key={name} value={name}>{eq.icon} {name} (Max {eq.maxWeight.toLocaleString()} lbs)</option>
              ))}
            </select>
            <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: "auto" }}>Max: <strong style={{ color: "var(--accent)" }}>{(groups[0]?.maxWt || maxWt).toLocaleString()} lbs</strong> per trailer</span>
          </div>

          {/* Dock Reservation */}
          <div style={{ padding: "12px 14px", background: "rgba(99,102,241,.04)", border: "1px solid rgba(99,102,241,.15)", borderRadius: 10, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" defaultChecked style={{ accentColor: "#6366f1" }} />
                <span style={{ fontSize: 12, fontWeight: 700 }}>Reserve Dock Door During Planning</span>
              </div>
              <span style={{ fontSize: 11, color: "var(--accent2)", fontWeight: 600 }}>Estimated Load Time: {loadDuration} min</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>Ship-From Dock (Auto)</div>
            <div style={{ padding: "8px 12px", background: "#fff", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
              {(lane.origin || "").split(",")[0]}, {(lane.origin || "").split(",")[1]?.trim() || ""} · Door 1 · 06:00–08:00 ({loadDuration} min)
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "var(--text3)" }}>Loading Duration</span>
              <select value={loadDuration} onChange={(e) => onModalChange((p) => p ? { ...p, loadDuration: Number(e.target.value) } : null)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 11 }}>
                <option value={60}>60 min</option><option value={90}>90 min</option><option value={120}>120 min</option><option value={150}>150 min</option><option value={180}>180 min</option>
              </select>
            </div>
            <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 6 }}>Rule of thumb: TL usually 60–120 min, LTL 45–90 min. Auto-estimate uses weight, pieces, and mode.</div>
          </div>

          {/* Shipment Groups */}
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
            {totalShipments} Shipment{totalShipments !== 1 ? "s" : ""} to Create
            {totalShipments > 1 && <span style={{ fontSize: 10, fontWeight: 500, color: "var(--text3)", marginLeft: 8, textTransform: "none" }}>(auto-split by weight limit)</span>}
          </div>

          {busy && !hasAnyQuotes && (
            <div style={{ textAlign: "center", padding: 20, color: "var(--text3)" }}>
              <div className="spinner" style={{ margin: "0 auto 8px" }} /><div style={{ fontSize: 12 }}>Fetching carrier rates...</div>
            </div>
          )}
          {error && <div style={{ padding: "10px 14px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, color: "#991b1b", fontSize: 12, marginBottom: 8 }}>{error}</div>}

          {!busy && groups.map((group, idx) => (
            <ShipmentGroupCard key={idx} group={group} groupIdx={idx} onSelectQuote={handleSelectQuote} />
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={() => onClose()} disabled={busy}>Cancel</button>
          <button className="btn btn-secondary">✏️ Manual Plan</button>
          <button className="btn btn-secondary" style={{ background: "rgba(124,58,237,.08)", color: "#7c3aed", borderColor: "rgba(124,58,237,.3)" }}>🔄 Cross-Dock</button>
          <button className="btn btn-primary" disabled={busy || !hasAnyQuotes} onClick={onConfirm} style={{ background: "linear-gradient(135deg,#059669,#10b981)", border: "none" }}>
            {busy ? "Creating..." : `✅ Confirm & Create ${totalShipments > 1 ? totalShipments + " Shipments" : "Shipment"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
