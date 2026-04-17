// ═══════════════════════════════════════════════════════════════════
// AddToShipmentModal — REQ-03.
//
// Minimal single-purpose modal the Orders page uses to manually attach
// an Unplanned order to an existing shipment. Renders a text field +
// typeahead-ish datalist of existing shipment ids, shows a weight/cost
// preview of the recalculation, and submits to the backend.
//
// Props:
//   order     — the full order row being added
//   shipments — the current shipments array from outlet context (used
//               for the autocomplete datalist + the local cost preview)
//   onCancel  — ()=>void
//   onSubmit  — (shipmentId)=>Promise<{ok, shipment, order, recalc}>
// ═══════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";

function fmtMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtInt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return Math.round(v).toLocaleString();
}

export default function AddToShipmentModal({ order, shipments = [], onCancel, onSubmit }) {
  const [shipmentId, setShipmentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Only offer shipments that are still addable (not Delivered/Cancelled).
  const addable = useMemo(
    () => (shipments || []).filter((s) => !["Delivered", "Cancelled"].includes(s?.status)),
    [shipments]
  );

  // Find the currently-entered shipment to show a preview card.
  const selected = useMemo(() => {
    const clean = (shipmentId || "").trim();
    return clean ? addable.find((s) => s.id === clean) : null;
  }, [shipmentId, addable]);

  // Preview recalculation (mirrors backend's proportional scaling).
  const preview = useMemo(() => {
    if (!selected || !order) return null;
    const ow = Number(selected.weight) || 0;
    const oc = Number(selected.total_cost ?? selected.cost) || 0;
    const add = Number(order.weight) || 0;
    const nw = ow + add;
    const np = (Number(selected.pieces) || 0) + (Number(order.pieces) || 0);
    let nc = oc;
    if (ow > 0) nc = Math.round(oc * (nw / ow) * 100) / 100;
    return {
      oldWeight: ow, oldPieces: Number(selected.pieces) || 0, oldCost: oc,
      addWeight: add, newWeight: nw, newPieces: np, newCost: nc,
      scale: ow > 0 ? nw / ow : 1,
    };
  }, [selected, order]);

  async function handleSubmit(e) {
    e?.preventDefault?.();
    const clean = (shipmentId || "").trim();
    if (!clean) { setError("Shipment ID is required"); return; }
    setError("");
    setBusy(true);
    try {
      await onSubmit(clean);
    } catch (err) {
      setError(err?.message || "Failed to add order to shipment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ width: 560, maxWidth: "92vw", background: "#fff", borderRadius: 16, boxShadow: "0 20px 50px rgba(0,0,0,.25)", overflow: "hidden" }}>
        <div style={{ padding: "18px 22px", background: "linear-gradient(135deg,#1a237e,#6366f1)", color: "#fff", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>📦</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Add Order to Shipment</div>
            <div style={{ fontSize: 12, opacity: .85 }}>Order <strong>{order?.id}</strong> · {fmtInt(order?.weight)} lbs · {fmtInt(order?.pieces)} pcs</div>
          </div>
          <button onClick={onCancel} style={{ background: "transparent", border: "none", color: "#fff", fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: "18px 22px" }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--text3)", letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 6 }}>
            Shipment ID
          </label>
          <input
            type="text"
            value={shipmentId}
            onChange={(e) => setShipmentId(e.target.value)}
            placeholder="e.g. SHP-2026-3355"
            list="add-to-ship-datalist"
            autoFocus
            disabled={busy}
            style={{ width: "100%", padding: "10px 12px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 14, fontFamily: "inherit" }}
          />
          <datalist id="add-to-ship-datalist">
            {addable.slice(0, 200).map((s) => (
              <option key={s.id} value={s.id}>
                {s.carrier || "—"} · {s.origin || "—"} → {s.destination || s.dest || "—"} · {fmtInt(s.weight)} lbs
              </option>
            ))}
          </datalist>

          {selected && preview && (
            <div style={{ marginTop: 14, border: "1.5px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "8px 14px", background: "#f8faff", borderBottom: "1px solid var(--border)", fontSize: 12, fontWeight: 700 }}>
                Shipment preview · {selected.carrier || "No carrier"} · {selected.mode || "—"}
              </div>
              <div style={{ padding: "10px 14px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, fontSize: 12 }}>
                <div>
                  <div style={{ color: "var(--text3)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>Weight</div>
                  <div><s style={{ color: "#94a3b8" }}>{fmtInt(preview.oldWeight)}</s> → <strong>{fmtInt(preview.newWeight)}</strong> lbs</div>
                </div>
                <div>
                  <div style={{ color: "var(--text3)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>Pieces</div>
                  <div><s style={{ color: "#94a3b8" }}>{fmtInt(preview.oldPieces)}</s> → <strong>{fmtInt(preview.newPieces)}</strong></div>
                </div>
                <div>
                  <div style={{ color: "var(--text3)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>Total Cost</div>
                  <div><s style={{ color: "#94a3b8" }}>{fmtMoney(preview.oldCost)}</s> → <strong>{fmtMoney(preview.newCost)}</strong></div>
                </div>
              </div>
              {preview.oldWeight === 0 && preview.oldCost > 0 && (
                <div style={{ padding: "6px 14px", background: "#fff7ed", borderTop: "1px solid var(--border)", fontSize: 11, color: "#b45309" }}>
                  Shipment has a cost but zero prior weight — cost will stay at {fmtMoney(preview.oldCost)} (cannot derive a per-lb rate).
                </div>
              )}
            </div>
          )}

          {!selected && shipmentId.trim() && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#b45309", background: "#fff7ed", padding: "8px 10px", borderRadius: 6 }}>
              No local shipment found for <code>{shipmentId.trim()}</code>. The server will still attempt to add if it exists remotely.
            </div>
          )}

          {error && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#991b1b", background: "#fee2e2", padding: "8px 10px", borderRadius: 6 }}>
              {error}
            </div>
          )}

          <div style={{ marginTop: 18, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !shipmentId.trim()} style={{ background: "linear-gradient(135deg,#1a237e,#6366f1)", border: "none" }}>
              {busy ? "Adding…" : "Add to Shipment →"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
