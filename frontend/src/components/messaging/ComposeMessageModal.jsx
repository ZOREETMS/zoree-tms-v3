import { useState, useEffect } from "react";
import { COMPOSE_TYPES, DESTINATION_SYSTEMS, PRIORITIES } from "../../types/messaging";
import { buildComposePayload } from "../../services/messagingService";

export default function ComposeMessageModal({ open, onClose, onSend, shipments = [] }) {
  const [type, setType] = useState("SHIPMENT_CREATE");
  const [refId, setRefId] = useState("");
  const [dest, setDest] = useState("WMS");
  const [priority, setPriority] = useState("NORMAL");
  const [notes, setNotes] = useState("");
  const [jsonText, setJsonText] = useState("");

  const selectedShipment = shipments.find((s) => s.id === refId) || null;

  useEffect(() => {
    regenerateJson();
  }, [type, refId]);

  function regenerateJson() {
    const payload = buildComposePayload(type, selectedShipment);
    setJsonText(JSON.stringify(payload, null, 2));
  }

  function handleSend() {
    let payload;
    try {
      payload = JSON.parse(jsonText);
    } catch {
      alert("Invalid JSON payload");
      return;
    }

    onSend({
      type,
      ref: refId,
      dest,
      priority,
      notes,
      payload,
    });

    // Reset
    setType("SHIPMENT_CREATE");
    setRefId("");
    setDest("WMS");
    setPriority("NORMAL");
    setNotes("");
    setJsonText("");
    onClose();
  }

  function handleValidate() {
    try {
      JSON.parse(jsonText);
      alert("JSON is valid");
    } catch (e) {
      alert(`Invalid JSON: ${e.message}`);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-overlay" style={{ display: "flex" }} onClick={onClose}>
      <div className="modal" style={{ width: 600, maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" style={{ background: "linear-gradient(135deg, #1e2d6b, #3b82f6)" }}>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,.6)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>
              TMS Messaging
            </div>
            <span className="modal-title" style={{ color: "#fff" }}>Compose Message</span>
          </div>
          <button className="modal-close" onClick={onClose} style={{ color: "rgba(255,255,255,.7)", fontSize: 22 }}>✕</button>
        </div>

        <div className="modal-body" style={{ padding: 24 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".8px", display: "block", marginBottom: 5 }}>
                Message Type
              </label>
              <select value={type} onChange={(e) => setType(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", background: "#fff" }}>
                {COMPOSE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".8px", display: "block", marginBottom: 5 }}>
                Reference (Shipment/Order)
              </label>
              <select value={refId} onChange={(e) => setRefId(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", background: "#fff" }}>
                <option value="">— Select shipment —</option>
                {shipments.map((s) => (
                  <option key={s.id} value={s.id}>{s.id} — {s.origin} → {s.dest}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".8px", display: "block", marginBottom: 5 }}>
                Destination System
              </label>
              <select value={dest} onChange={(e) => setDest(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", background: "#fff" }}>
                {DESTINATION_SYSTEMS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".8px", display: "block", marginBottom: 5 }}>
                Priority
              </label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", background: "#fff" }}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".8px" }}>
                JSON Payload
              </label>
              <button onClick={regenerateJson} style={{ padding: "3px 10px", background: "#f0f4ff", border: "1px solid var(--border2)", borderRadius: 6, fontSize: 11, color: "var(--accent)", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
                ↺ Regenerate
              </button>
            </div>
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              rows={14}
              style={{ width: "100%", padding: 12, border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 12, fontFamily: "monospace", resize: "vertical", background: "#1e1e2e", color: "#cdd6f4", boxSizing: "border-box", lineHeight: 1.6 }}
            />
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".8px", display: "block", marginBottom: 5 }}>
              Notes / Memo
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional internal note…"
              style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-secondary" onClick={handleValidate}>✅ Validate JSON</button>
          <button className="btn btn-primary" onClick={handleSend}>📤 Send Message</button>
        </div>
      </div>
    </div>
  );
}
