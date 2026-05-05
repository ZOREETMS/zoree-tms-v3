// ═══════════════════════════════════════════════════════════════════
// Cross-Dock Modal — TMS bug #3.
//
// Resolves the dead "Cross-Dock" button on the Plan This Order modal.
// Lets a planner designate a cross-dock waypoint (warehouse city +
// optional dock door) and continue with the regular plan flow. The
// cross-dock intent is captured as a structured note on every order in
// the plan so the dispatcher / receiving team see it on the BOL and
// the order's notes field.
//
// This is intentionally a thin first cut — full multi-leg cross-dock
// shipment creation (origin → CD warehouse → dest with two carriers)
// is its own follow-up. Today's contract:
//   onConfirm({ warehouse, dockDoor, notes }) — parent stamps the note
//                                               on each order in the
//                                               plan and proceeds with
//                                               regular execution.
// ═══════════════════════════════════════════════════════════════════

import React, { useEffect, useState } from "react";

export default function CrossDockModal({
  show,
  lane,
  warehouseDockConfigs = [],
  onCancel,
  onConfirm,
}) {
  const [form, setForm] = useState({ warehouse: "", dockDoor: "", notes: "" });

  // Reset form whenever the modal opens for a different lane.
  useEffect(() => {
    if (show) setForm({ warehouse: "", dockDoor: "", notes: "" });
  }, [show, lane?.laneKey]);

  if (!show) return null;

  const wares = (warehouseDockConfigs || [])
    .map((w) => w?.warehouse || w?.name || "")
    .filter(Boolean);

  const canSubmit = String(form.warehouse || "").trim().length > 0;

  function submit() {
    if (!canSubmit) return;
    const w = String(form.warehouse).trim();
    const d = String(form.dockDoor || "").trim();
    const note = `CROSS-DOCK via ${w}${d ? ` (Dock ${d})` : ""}` +
      (form.notes ? ` — ${String(form.notes).trim()}` : "");
    onConfirm({ warehouse: w, dockDoor: d || null, note });
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>🔄 Cross-Dock Setup</h3>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12, lineHeight: 1.5 }}>
            Designate a cross-dock waypoint for this shipment.
            {lane && (
              <div style={{ marginTop: 6, fontSize: 11, color: "var(--text2)" }}>
                Lane: <strong>{(lane.origin || "").split(",")[0]}</strong>
                {" → "}<em style={{ color: "var(--accent)" }}>warehouse</em>{" → "}
                <strong>{(lane.destination || "").split(",")[0]}</strong>
              </div>
            )}
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)" }}>
              Cross-Dock Warehouse *
            </label>
            <input
              list="cross-dock-warehouses"
              value={form.warehouse}
              onChange={(e) => setForm((f) => ({ ...f, warehouse: e.target.value }))}
              placeholder="e.g. Memphis, TN"
              style={{
                width: "100%", padding: "8px 10px", marginTop: 4,
                border: "1.5px solid var(--border)", borderRadius: 8,
                fontSize: 13, fontFamily: "inherit", boxSizing: "border-box",
              }}
            />
            <datalist id="cross-dock-warehouses">
              {wares.map((w) => <option key={w} value={w} />)}
            </datalist>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)" }}>
              Dock Door at Cross-Dock (optional)
            </label>
            <input
              value={form.dockDoor}
              onChange={(e) => setForm((f) => ({ ...f, dockDoor: e.target.value }))}
              placeholder="e.g. Door 4"
              style={{
                width: "100%", padding: "8px 10px", marginTop: 4,
                border: "1.5px solid var(--border)", borderRadius: 8,
                fontSize: 13, fontFamily: "inherit", boxSizing: "border-box",
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)" }}>
              Notes (optional)
            </label>
            <input
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Additional handling instructions"
              style={{
                width: "100%", padding: "8px 10px", marginTop: 4,
                border: "1.5px solid var(--border)", borderRadius: 8,
                fontSize: 13, fontFamily: "inherit", boxSizing: "border-box",
              }}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={!canSubmit} onClick={submit}
            style={{ background: "linear-gradient(135deg,#7c3aed,#a855f7)", border: "none" }}>
            🔄 Apply Cross-Dock & Continue
          </button>
        </div>
      </div>
    </div>
  );
}
