import { EQUIPMENT_TYPES, DEFAULT_EQUIP } from "../../constants/orders";
import ShipmentGroupCard from "./ShipmentGroupCard";
import DockReservationSection from "./DockReservationSection";

export default function PlanConfirmationModal({ planModal, onModalChange, onConfirm, onClose }) {
  if (!planModal) return null;

  const { lane, siblings, busy, error, maxWt, util, loadDuration, equipType, shipmentGroups, reserveDock } = planModal;
  const dockEnabled = reserveDock !== false;
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
          {/* Equipment Selector */}
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

          <DockReservationSection
            dockEnabled={dockEnabled}
            dockDoor={planModal.dockDoor}
            dockStartTime={planModal.dockStartTime}
            loadDuration={loadDuration}
            onModalChange={onModalChange}
          />

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
