// Carrier sourcing input: one shipment, or scan Planned loads with no carrier.
import { useState } from "react";
import { ui } from "../styles";
import { DEMO_IDS } from "../../../constants/agentDemo";

export default function SourcingForm({ onRun, busy }) {
  const [shipmentId, setShipmentId] = useState("");
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
      <div style={{ width: 240 }}>
        <span style={ui.label}>Shipment</span>
        <input style={ui.input()} value={shipmentId} onChange={(e) => setShipmentId(e.target.value)} placeholder="SHP-…" />
      </div>
      <button style={ui.link} onClick={() => setShipmentId(DEMO_IDS.sourcingShipment)}>Use demo load</button>
      <button style={{ ...ui.btn, opacity: busy || !shipmentId ? 0.6 : 1 }} disabled={busy || !shipmentId} onClick={() => onRun({ shipmentId })}>
        {busy ? "Ranking carriers…" : "Source carriers"}
      </button>
      <button style={ui.btn2} disabled={busy} onClick={() => onRun({ scan: true, limit: 3 })}>Scan loads with no carrier</button>
    </div>
  );
}
