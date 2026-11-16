// Quote agent input: paste an RFQ email, or enter one lane.
import { useState } from "react";
import { ui } from "../styles";
import { DEMO_RFQ } from "../../../constants/agentDemo";

export default function QuoteForm({ onRun, busy }) {
  const [mode, setMode] = useState("email");
  const [email, setEmail] = useState({ from: "", subject: "", emailText: "" });
  const [lane, setLane] = useState({ origin: "", dest: "", weight: "", customer: "", contactEmail: "" });
  const [marginPct, setMarginPct] = useState("");
  const setE = (k) => (e) => setEmail((p) => ({ ...p, [k]: e.target.value }));
  const setL = (k) => (e) => setLane((p) => ({ ...p, [k]: e.target.value }));
  const run = () => onRun({ ...(mode === "email" ? email : lane), marginPct });

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button style={ui.tab(mode === "email")} onClick={() => setMode("email")}>RFQ email</button>
        <button style={ui.tab(mode === "lane")} onClick={() => setMode("lane")}>Single lane</button>
        <span style={{ flex: 1 }} />
        {mode === "email" && <button style={ui.link} onClick={() => setEmail(DEMO_RFQ)}>Load demo RFQ</button>}
      </div>
      {mode === "email" ? (
        <>
          <div style={ui.formGrid}>
            <div><span style={ui.label}>From</span><input style={{ ...ui.input(), ...ui.plain }} value={email.from} onChange={setE("from")} placeholder="Name <email@company.com>" /></div>
            <div><span style={ui.label}>Subject</span><input style={{ ...ui.input(), ...ui.plain }} value={email.subject} onChange={setE("subject")} /></div>
          </div>
          <span style={{ ...ui.label, marginTop: 10 }}>Email</span>
          <textarea style={ui.textarea} value={email.emailText} onChange={setE("emailText")} placeholder="Paste the customer's rate request…" />
        </>
      ) : (
        <div style={ui.formGrid}>
          {[["origin", "Origin (City, ST ZIP)"], ["dest", "Destination"], ["weight", "Weight (lbs)"], ["customer", "Customer"], ["contactEmail", "Reply to"]].map(([k, l]) => (
            <div key={k}><span style={ui.label}>{l}</span><input style={ui.input()} value={lane[k]} onChange={setL(k)} /></div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, alignItems: "end", marginTop: 12 }}>
        <div style={{ width: 140 }}><span style={ui.label}>Margin % (blank = default)</span><input style={ui.input()} value={marginPct} onChange={(e) => setMarginPct(e.target.value)} /></div>
        <button style={{ ...ui.btn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={run}>{busy ? "Rating lanes…" : "Run Quote Agent"}</button>
      </div>
    </div>
  );
}
