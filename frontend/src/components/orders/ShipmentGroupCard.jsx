import { EQUIPMENT_TYPES, DEFAULT_EQUIP } from "../../constants/orders";
import { fmt$, calcDates } from "../../utils/orderUtils.jsx";

export default function ShipmentGroupCard({ group, groupIdx, onSelectQuote }) {
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
          // Composite key: a carrier can now appear multiple times in
          // the quotes list (one per matching rate, e.g. STD + EXP on
          // the same lane). Index alone is fine, but pairing it with
          // rateId / serviceLevel keeps React's diff stable if the
          // backend reorders the list between fetches.
          const rowKey = `${quote.rateId || quote.carrier}-${quote.serviceLevel || "std"}-${i}`;
          return (
            <div key={rowKey}
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
