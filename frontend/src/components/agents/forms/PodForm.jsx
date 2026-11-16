// POD agent input: a photo / PDF, or pasted document text.
import { useState } from "react";
import { ui } from "../styles";
import { fileToPayload } from "../../../services/agentsService";
import { DEMO_POD_TEXT, DEMO_POD_IMAGE } from "../../../constants/agentDemo";

export default function PodForm({ onRun, busy }) {
  const [file, setFile] = useState(null);
  const [text, setText] = useState("");
  const [shipmentId, setShipmentId] = useState("");
  const [error, setError] = useState("");

  async function useDemoPhoto() {
    setError("");
    try {
      const blob = await fetch(DEMO_POD_IMAGE).then((r) => r.blob());
      setFile(new File([blob], "pod-sample.png", { type: blob.type || "image/png" }));
    } catch (e) { setError(`Could not load the demo photo: ${e.message}`); }
  }

  async function run() {
    setError("");
    try {
      const filePart = file ? await fileToPayload(file) : {};
      onRun({ ...filePart, documentText: text, shipmentId: shipmentId || undefined });
    } catch (e) { setError(e.message); }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files[0] || null)} />
        <button style={ui.link} onClick={useDemoPhoto}>Use demo POD photo</button>
        <button style={ui.link} onClick={() => setText(DEMO_POD_TEXT)}>Use demo POD text</button>
      </div>
      {file && <div style={{ ...ui.muted, marginTop: 6 }}>Attached: {file.name} ({Math.round(file.size / 1024)} KB)</div>}
      {file && file.type.startsWith("image/") && <img src={URL.createObjectURL(file)} alt="POD preview" style={{ maxWidth: 440, marginTop: 8, borderRadius: 8, border: "1px solid #e2e8f0" }} />}
      <textarea style={{ ...ui.textarea, minHeight: 90, marginTop: 8 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="…or paste the POD / BOL text" />
      <div style={{ display: "flex", gap: 10, alignItems: "end", marginTop: 8 }}>
        <div style={{ width: 220 }}><span style={ui.label}>Shipment (optional)</span><input style={ui.input()} value={shipmentId} onChange={(e) => setShipmentId(e.target.value)} placeholder="matched from the document" /></div>
        <button style={{ ...ui.btn, opacity: busy || (!file && !text.trim()) ? 0.6 : 1 }} disabled={busy || (!file && !text.trim())} onClick={run}>{busy ? "Reading document…" : "Read document"}</button>
      </div>
      {error && <div style={ui.err}>{error}</div>}
    </div>
  );
}
