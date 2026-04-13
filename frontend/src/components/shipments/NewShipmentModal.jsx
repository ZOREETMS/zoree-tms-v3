import React, { useState } from "react";
import { buildBlankShipment } from "../../services/shipmentService";

const MODES = ["LTL", "TL"];
const SERVICE_LEVELS = ["Standard", "Expedited", "Economy", "White Glove", "Time-Critical"];

export default function NewShipmentModal({ carriers, onSave, onClose }) {
  const [form, setForm] = useState(buildBlankShipment());
  const [saving, setSaving] = useState(false);

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.origin || !form.dest) return;
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = {
    width: "100%", padding: "9px 12px", border: "1.5px solid var(--border)",
    borderRadius: 8, fontSize: 13, background: "var(--bg2)", color: "var(--text)",
    boxSizing: "border-box", fontFamily: "inherit",
  };
  const labelStyle = {
    fontSize: 11, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase",
    letterSpacing: 0.5, display: "block", marginBottom: 5,
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        style={{
          background: "var(--bg)", borderRadius: 16, width: 580, maxWidth: "95vw",
          maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,.4)",
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          background: "linear-gradient(135deg,#1e3a5f,#2563eb)", padding: "20px 24px",
          borderRadius: "16px 16px 0 0", display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>+ New Shipment</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,.8)", marginTop: 3 }}>Create a manual shipment</div>
          </div>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,.15)", border: "none", color: "#fff", width: 30, height: 30,
            borderRadius: "50%", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            ✕
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ padding: "20px 24px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 14 }}>
              Shipment Details
            </div>

            {/* Origin / Destination */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>Origin *</label>
                <input value={form.origin} onChange={(e) => set("origin", e.target.value)} placeholder="e.g. Dallas, TX" style={inputStyle} required />
              </div>
              <div>
                <label style={labelStyle}>Destination *</label>
                <input value={form.dest} onChange={(e) => set("dest", e.target.value)} placeholder="e.g. Chicago, IL" style={inputStyle} required />
              </div>
            </div>

            {/* Mode / Carrier */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>Mode</label>
                <select value={form.mode} onChange={(e) => set("mode", e.target.value)} style={inputStyle}>
                  {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Carrier</label>
                <select value={form.carrier} onChange={(e) => set("carrier", e.target.value)} style={inputStyle}>
                  <option value="">-- Select Carrier --</option>
                  {(carriers || []).map((c) => (
                    <option key={c.id || c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Weight / Pieces / Cost */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>Weight (lbs)</label>
                <input type="number" value={form.weight} onChange={(e) => set("weight", e.target.value)} placeholder="0" style={inputStyle} min="0" />
              </div>
              <div>
                <label style={labelStyle}>Pieces</label>
                <input type="number" value={form.pieces} onChange={(e) => set("pieces", e.target.value)} placeholder="0" style={inputStyle} min="0" />
              </div>
              <div>
                <label style={labelStyle}>Est. Cost ($)</label>
                <input type="number" value={form.total_cost} onChange={(e) => set("total_cost", e.target.value)} placeholder="0" style={inputStyle} min="0" step="0.01" />
              </div>
            </div>

            {/* Dates */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>Pickup Date</label>
                <input type="date" value={form.pickup_date} onChange={(e) => set("pickup_date", e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Delivery Date</label>
                <input type="date" value={form.delivery_date} onChange={(e) => set("delivery_date", e.target.value)} style={inputStyle} />
              </div>
            </div>

            {/* Service Level */}
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Service Level</label>
              <select value={form.service_level} onChange={(e) => set("service_level", e.target.value)} style={inputStyle}>
                {SERVICE_LEVELS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Notes */}
            <div style={{ marginBottom: 6 }}>
              <label style={labelStyle}>Notes (optional)</label>
              <textarea
                value={form.notes} onChange={(e) => set("notes", e.target.value)}
                placeholder="Any additional notes"
                rows={2}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </div>
          </div>

          {/* Footer */}
          <div style={{
            padding: "16px 24px", borderTop: "1px solid var(--border)", display: "flex", gap: 10,
            justifyContent: "flex-end", background: "var(--bg2)", borderRadius: "0 0 16px 16px",
          }}>
            <button type="button" onClick={onClose} style={{
              padding: "10px 20px", background: "var(--bg)", border: "1.5px solid var(--border)",
              borderRadius: 8, fontSize: 13, fontWeight: 600, color: "var(--text2)", cursor: "pointer", fontFamily: "inherit",
            }}>
              Cancel
            </button>
            <button type="submit" disabled={saving || !form.origin || !form.dest} style={{
              padding: "10px 24px", background: "#2563eb", border: "none", borderRadius: 8,
              fontSize: 13, fontWeight: 700, color: "#fff", cursor: "pointer", fontFamily: "inherit",
              opacity: saving || !form.origin || !form.dest ? 0.5 : 1,
            }}>
              {saving ? "Creating..." : "Create Shipment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
