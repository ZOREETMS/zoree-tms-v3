import { useState } from "react";
import useAccessorialApprovals from "../../hooks/useAccessorialApprovals";
import { ACCESSORIAL_TYPES, approvalBasis, typeLabel } from "../../services/accessorialApprovalService";

const EMPTY = { accessorialType: "detention", basis: "hourly", maxHours: "", ratePerHour: "", maxAmount: "", notes: "" };
const sectionTitle = { fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 };
const input = { padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, fontFamily: "inherit" };

// Approved extras on a shipment. Freight Audit pays a carrier's liftgate /
// detention / lumper only up to what is approved here.
export default function ShipmentAccessorialApprovals({ shipmentId, canEdit = true }) {
  const { approvals, loading, error, add, remove } = useAccessorialApprovals(shipmentId);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    setSaving(true);
    setFormError("");
    try { await add(form); setForm(EMPTY); }
    catch (e) { setFormError(e.message || "Could not save"); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
      <div style={sectionTitle}>Approved extras (checked against carrier invoices)</div>
      {loading && <div style={{ fontSize: 12, color: "var(--text3)" }}>Loading…</div>}
      {error && <div style={{ fontSize: 12, color: "#b91c1c" }}>{error}</div>}
      {!loading && !approvals.length && (
        <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>
          None. Any liftgate, detention or other extra billed on this shipment will be held for AP.
        </div>
      )}
      {approvals.map((a) => (
        <div key={a.id} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, padding: "6px 0" }}>
          <b>{typeLabel(a.accessorial_type)}</b>
          <span>{approvalBasis(a)}</span>
          <span style={{ color: "var(--text3)" }}>· approved by {a.approved_by}</span>
          {a.notes && <span style={{ color: "var(--text3)" }}>· {a.notes}</span>}
          {canEdit && <button className="btn btn-secondary btn-sm" style={{ marginLeft: "auto" }} onClick={() => remove(a.id)}>Remove</button>}
        </div>
      ))}
      {canEdit && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
          <select style={input} value={form.accessorialType} onChange={set("accessorialType")}>
            {ACCESSORIAL_TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
          </select>
          <select style={input} value={form.basis} onChange={set("basis")}>
            <option value="hourly">Hours × rate</option>
            <option value="flat">Up to amount</option>
          </select>
          {form.basis === "hourly" ? (
            <>
              <input style={{ ...input, width: 70 }} type="number" min="0" step="0.25" placeholder="Hours" value={form.maxHours} onChange={set("maxHours")} />
              <input style={{ ...input, width: 90 }} type="number" min="0" step="0.01" placeholder="$ / hr" value={form.ratePerHour} onChange={set("ratePerHour")} />
            </>
          ) : (
            <input style={{ ...input, width: 110 }} type="number" min="0" step="0.01" placeholder="Max $" value={form.maxAmount} onChange={set("maxAmount")} />
          )}
          <input style={{ ...input, flex: 1, minWidth: 140 }} placeholder="Note (optional)" value={form.notes} onChange={set("notes")} />
          <button className="btn btn-primary btn-sm" disabled={saving} onClick={submit}>{saving ? "Saving…" : "Approve extra"}</button>
        </div>
      )}
      {formError && <div style={{ fontSize: 12, color: "#b91c1c", marginTop: 6 }}>{formError}</div>}
    </div>
  );
}
