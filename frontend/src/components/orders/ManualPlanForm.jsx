// ═══════════════════════════════════════════════════════════════════
// Manual Plan Form — TMS bug #4.
//
// Inline alternative to the auto-rate quote list inside
// PlanConfirmationModal. Lets a planner bypass the rate engine and
// enter carrier + cost + dates by hand. Used when:
//   - There's no rate row for the lane in the rate table.
//   - The planner negotiated a one-off spot rate and just wants to
//     book the shipment.
//
// The output shape (the `manualQuote` passed up via onChange) mirrors
// the bestQuote contract that bulkPlanService.buildPlan reads from, so
// the same downstream executor (BulkPlanApi.execute) creates the
// shipment with no special-casing.
// ═══════════════════════════════════════════════════════════════════

import React from "react";

const MODES = ["LTL", "TL", "Intermodal", "Flatbed", "Reefer", "Parcel", "Air Freight"];
const SERVICE_LEVELS = ["Standard", "Expedited", "Economy", "Guaranteed", "White Glove", "Time-Critical"];

export default function ManualPlanForm({ form, onFormChange, carriers = [] }) {
  const f = form || {};
  const set = (key) => (e) => onFormChange((prev) => ({ ...(prev || {}), [key]: e.target.value }));
  const setNum = (key) => (e) => {
    const n = e.target.value === "" ? "" : Number(e.target.value);
    onFormChange((prev) => ({ ...(prev || {}), [key]: n }));
  };

  return (
    <div style={{
      padding: "14px 16px", background: "#fff",
      border: "1.5px dashed rgba(99,102,241,.3)",
      borderRadius: 12, marginBottom: 12,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: "var(--accent)",
        textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10,
      }}>
        ✏️ Manual Plan — bypass the rate engine and enter values directly
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)" }}>Carrier *</label>
          <input
            list="manual-plan-carriers"
            value={f.carrier || ""}
            onChange={set("carrier")}
            placeholder="Type or pick a carrier"
            style={{ width: "100%", padding: "7px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 4 }}
          />
          <datalist id="manual-plan-carriers">
            {(carriers || []).map((c) => (
              <option key={c.id || c.name} value={c.name || c.id} />
            ))}
          </datalist>
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)" }}>Mode</label>
          <select value={f.mode || "TL"} onChange={set("mode")}
            style={{ width: "100%", padding: "7px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, background: "#fff", marginTop: 4 }}>
            {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 8 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)" }}>Total Cost ($) *</label>
          <input type="number" min="0" step="0.01"
            value={f.totalCost ?? ""} onChange={setNum("totalCost")}
            placeholder="e.g. 1450"
            style={{ width: "100%", padding: "7px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, marginTop: 4, boxSizing: "border-box" }}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)" }}>Fuel Surcharge ($)</label>
          <input type="number" min="0" step="0.01"
            value={f.fuelSurcharge ?? ""} onChange={setNum("fuelSurcharge")}
            placeholder="0"
            style={{ width: "100%", padding: "7px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, marginTop: 4, boxSizing: "border-box" }}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)" }}>Transit (days) *</label>
          <input type="number" min="1" step="1"
            value={f.transitDays ?? ""} onChange={setNum("transitDays")}
            placeholder="e.g. 3"
            style={{ width: "100%", padding: "7px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, marginTop: 4, boxSizing: "border-box" }}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)" }}>Service Level</label>
          <select value={f.serviceLevel || "Standard"} onChange={set("serviceLevel")}
            style={{ width: "100%", padding: "7px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, background: "#fff", marginTop: 4 }}>
            {SERVICE_LEVELS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)" }}>Notes (optional)</label>
          <input value={f.notes || ""} onChange={set("notes")}
            placeholder="e.g. Spot rate negotiated 2026-05-03"
            style={{ width: "100%", padding: "7px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, marginTop: 4, boxSizing: "border-box" }}
          />
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 11, color: "var(--text3)" }}>
        Required: Carrier, Total Cost, Transit (days). Pickup/Delivery dates are computed from the order's Ready/Due plus Transit days.
      </div>
    </div>
  );
}

/**
 * Build a quote-shaped object from the manual form. Mirrors the
 * bestQuote contract that bulkPlanService#buildPlan reads from so a
 * manual plan executes through exactly the same path as an auto-rated
 * one (single source of truth — see CLAUDE_RULES §10).
 */
export function manualFormToQuote(form) {
  const f = form || {};
  const total = Number(f.totalCost) || 0;
  const fsc   = Number(f.fuelSurcharge) || 0;
  return {
    carrier:      String(f.carrier || "").trim(),
    mode:         f.mode || "TL",
    totalCharge:  total,
    czarBase:     Math.max(0, total - fsc),
    czarBaseGross: Math.max(0, total - fsc),
    fscCharge:    fsc,
    accessorialCharge: 0,
    transitDays:  Number(f.transitDays) || 0,
    serviceLevel: f.serviceLevel || "Standard",
    rateId:       null,
    miles:        null,
    pcmilerMiles: null,
    manual:       true,
  };
}

/** Validation: returns null when the form is good to submit, error string otherwise. */
export function validateManualForm(form) {
  const f = form || {};
  if (!String(f.carrier || "").trim()) return "Carrier is required";
  if (!(Number(f.totalCost) > 0))      return "Total Cost must be greater than 0";
  if (!(Number(f.transitDays) > 0))    return "Transit (days) must be greater than 0";
  return null;
}
