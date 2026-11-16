// Track & trace input: scan moving loads, or read a carrier's reply.
import { useState } from "react";
import { ui } from "../styles";
import { DEMO_IDS, DEMO_CARRIER_REPLY } from "../../../constants/agentDemo";

export default function TraceForm({ onRun, busy }) {
  const [shipmentId, setShipmentId] = useState("");
  const [carrierReply, setReply] = useState("");
  return (
    <div>
      <button style={{ ...ui.btn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => onRun({ scan: true })}>
        {busy ? "Scanning…" : "Scan moving loads for risk"}
      </button>
      <div style={{ ...ui.section, marginTop: 16 }}>Got a carrier reply? Let the agent read it</div>
      <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap", marginTop: 6 }}>
        <div style={{ width: 220 }}><span style={ui.label}>Shipment</span><input style={ui.input()} value={shipmentId} onChange={(e) => setShipmentId(e.target.value)} placeholder="SHP-…" /></div>
        <button style={ui.link} onClick={() => { setShipmentId(DEMO_IDS.traceShipment); setReply(DEMO_CARRIER_REPLY); }}>Load demo reply</button>
      </div>
      <textarea style={{ ...ui.textarea, minHeight: 80, marginTop: 8 }} value={carrierReply} onChange={(e) => setReply(e.target.value)} placeholder="Paste the carrier's email / text…" />
      <button style={{ ...ui.btn2, marginTop: 8 }} disabled={busy || !shipmentId || !carrierReply.trim()} onClick={() => onRun({ shipmentId, carrierReply })}>Read reply</button>
    </div>
  );
}
