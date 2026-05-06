import { EQUIPMENT_TYPES, DEFAULT_EQUIP } from "../../constants/orders";
import ShipmentGroupCard from "./ShipmentGroupCard";
import DockReservationSection from "./DockReservationSection";
// TMS bug #4: inline manual-plan form rendered when manualMode is on.
import ManualPlanForm, { validateManualForm } from "./ManualPlanForm";
// Reseed the dock-loading duration when the planner picks a quote whose
// mode differs from the lane's initial estimate, so the modal display
// matches what the resulting shipment will actually be booked for.
import { getInitialLoadDuration } from "../../services/dockService";
// LTL/TL ceilings come from equipment_types via this hook — never from
// hardcoded numbers in this file. The dropdown options below are
// presentation-only (icon + name); the actual capacity enforced when
// the user switches equipment is sourced from the DB.
import { useEquipmentLimits } from "../../services/equipmentLimitsService";

export default function PlanConfirmationModal({
  planModal, onModalChange, onConfirm, onClose,
  // TMS bugs #3 + #4: callbacks that the parent uses to switch into
  // Manual or Cross-Dock flows. Both are optional so existing callers
  // that don't pass them (none today) just see the original layout.
  onManualPlan,
  onCrossDock,
  carriers = [],
}) {
  // Hook must run before any early return.
  const { data: limits } = useEquipmentLimits();
  if (!planModal) return null;

  const { lane, siblings, busy, error, maxWt, util, loadDuration, equipType, shipmentGroups, reserveDock, dockSchedulingEnabled } = planModal;
  const dockEnabled = reserveDock !== false;
  const groups = shipmentGroups && shipmentGroups.length > 0
    ? shipmentGroups
    : [{ lane, orders: siblings, quotes: planModal.quotes || [], selectedIdx: planModal.selectedIdx || 0, bestQuote: planModal.bestQuote, equipType, maxWt, util }];

  const totalShipments = groups.length;
  const totalOrders = groups.reduce((s, g) => s + (g.lane?.orderIds?.length || 0), 0);
  const hasAnyQuotes = groups.some((g) => g.quotes?.some((q) => q.transitDays > 0));

  // TMS bug #4: when manualMode is on we render ManualPlanForm in place
  // of the auto-fetched quote list and route Confirm through the manual
  // path. The form state lives on planModal so the parent can read it
  // back at confirm time without prop drilling.
  const manualMode = !!planModal.manualMode;
  const manualForm = planModal.manualForm || {};
  const manualValidationError = manualMode ? validateManualForm(manualForm) : null;
  const confirmDisabled = manualMode
    ? (busy || !!manualValidationError)
    : (busy || !hasAnyQuotes);

  function handleSelectQuote(groupIdx, quoteIdx) {
    onModalChange((prev) => {
      if (!prev) return null;
      const updated = [...(prev.shipmentGroups || groups)];
      updated[groupIdx] = { ...updated[groupIdx], selectedIdx: quoteIdx };
      // Reseed the displayed loading duration from the newly chosen
      // quote's mode, but only when the user hasn't manually overridden
      // it via the dropdown. Use group 0 as the source of truth for the
      // single-modal-display since `loadDuration` is a top-level field;
      // multi-group plans with mixed modes get per-group durations
      // applied at confirm time regardless of what's shown here.
      let nextDuration = prev.loadDuration;
      if (!prev.loadDurationOverridden) {
        const displayGroup = updated[0] || updated[groupIdx];
        const displayQuote = displayGroup?.quotes?.[displayGroup.selectedIdx];
        if (displayQuote) {
          nextDuration = getInitialLoadDuration({
            mode: displayQuote.mode,
            equipType: displayGroup.equipType,
          });
        }
      }
      return { ...prev, shipmentGroups: updated, loadDuration: nextDuration };
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
                // LTL Truck → equipment_types.LTL.max_weight, anything else →
                // equipment_types.DV53.max_weight (the configured TL default).
                // No hardcoded fallback — if `limits` hasn't loaded yet, leave
                // maxWt unchanged rather than inventing a number.
                if (!limits) return;
                const newMax = newEquip === "LTL Truck" ? limits.ltlMax : limits.tlMax;
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
              {Object.entries(EQUIPMENT_TYPES).map(([name, eq]) => {
                // Icons + names are presentation only; max weight comes from
                // equipment_types via useEquipmentLimits. While limits are
                // loading we hide the parenthetical max rather than fabricate.
                const max = limits
                  ? (name === "LTL Truck" ? limits.ltlMax : limits.tlMax)
                  : null;
                const label = max != null
                  ? `${eq.icon} ${name} (Max ${max.toLocaleString()} lbs)`
                  : `${eq.icon} ${name}`;
                return <option key={name} value={name}>{label}</option>;
              })}
            </select>
            <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: "auto" }}>Max: <strong style={{ color: "var(--accent)" }}>{(groups[0]?.maxWt || maxWt).toLocaleString()} lbs</strong> per trailer</span>
          </div>

          {dockSchedulingEnabled !== false && (
            <DockReservationSection
              dockEnabled={dockEnabled}
              dockDoor={planModal.dockDoor}
              dockStartTime={planModal.dockStartTime}
              loadDuration={loadDuration}
              onModalChange={onModalChange}
            />
          )}

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

          {/* TMS bug #4: manual-plan path replaces the quote list with
              an inline form. Submit goes through the same onConfirm
              handler — the parent inspects planModal.manualMode to
              build the right plan. */}
          {manualMode ? (
            <ManualPlanForm
              form={manualForm}
              onFormChange={(updater) =>
                onModalChange((prev) => {
                  if (!prev) return null;
                  const next = typeof updater === "function" ? updater(prev.manualForm || {}) : updater;
                  return { ...prev, manualForm: next };
                })
              }
              carriers={carriers}
            />
          ) : (
            !busy && groups.map((group, idx) => (
              <ShipmentGroupCard key={idx} group={group} groupIdx={idx} onSelectQuote={handleSelectQuote} />
            ))
          )}

          {manualMode && manualValidationError && (
            <div style={{ padding: "8px 12px", background: "#fef3c7", border: "1px solid #fbbf24", color: "#92400e", borderRadius: 8, fontSize: 12 }}>
              {manualValidationError}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={() => onClose()} disabled={busy}>Cancel</button>
          {/* TMS bug #4: toggle into manual entry mode. Disabled when no
              callback is wired (defensive — keeps the button visibly
              non-functional rather than throwing). */}
          <button
            className="btn btn-secondary"
            disabled={busy || !onManualPlan}
            onClick={onManualPlan ? () => onManualPlan() : undefined}
            style={manualMode ? { background: "rgba(99,102,241,.12)", borderColor: "rgba(99,102,241,.3)", color: "var(--accent)" } : undefined}
            title={manualMode ? "Currently in manual mode — click again to return to auto rates" : "Bypass rate engine and enter values manually"}
          >
            ✏️ {manualMode ? "Manual Mode" : "Manual Plan"}
          </button>
          {/* TMS bug #3: Cross-Dock opens a modal that captures the
              waypoint info. The modal itself lives in OrdersPage so it
              has access to warehouse-dock configs. */}
          <button
            className="btn btn-secondary"
            disabled={busy || !onCrossDock}
            onClick={onCrossDock ? () => onCrossDock() : undefined}
            style={{ background: "rgba(124,58,237,.08)", color: "#7c3aed", borderColor: "rgba(124,58,237,.3)" }}
            title="Designate a cross-dock waypoint for this shipment"
          >
            🔄 Cross-Dock
          </button>
          <button className="btn btn-primary" disabled={confirmDisabled} onClick={onConfirm} style={{ background: "linear-gradient(135deg,#059669,#10b981)", border: "none" }}>
            {busy ? "Creating..." : manualMode ? "✅ Create Manual Shipment" : `✅ Confirm & Create ${totalShipments > 1 ? totalShipments + " Shipments" : "Shipment"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
