// Run the agent on an email pasted by hand — for demos and for emails
// that arrived outside the watched mailbox.
import { useState } from "react";
import { runOnPastedEmail } from "../../services/emailIntakeService";
import { ui } from "./styles";
import { DEMO_ORDER_EMAIL } from "../../constants/agentDemo";

const plain = { textTransform: "none" }; // the app uppercases inputs; emails keep their case

export default function PastePanel({ onDone }) {
  const [form, setForm] = useState({ from: "", subject: "", body: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function run() {
    if (!form.body.trim()) return;
    setBusy(true); setError("");
    try {
      const row = await runOnPastedEmail(form);
      setForm({ from: "", subject: "", body: "" });
      onDone && onDone(row);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  return (
    <div style={{ ...ui.card, background: "#f8fafc" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>Paste an email</div>
        <span style={{ flex: 1 }} />
        <button style={ui.link} onClick={() => setForm(DEMO_ORDER_EMAIL)}>Load demo order email</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <input style={{ ...ui.input(false), ...plain }} placeholder="From (e.g. Maria Lopez <maria@cisco.com>)" value={form.from} onChange={set("from")} />
        <input style={{ ...ui.input(false), ...plain }} placeholder="Subject" value={form.subject} onChange={set("subject")} />
      </div>
      <textarea style={{ ...ui.input(false), ...plain, marginTop: 10, minHeight: 140, fontFamily: "inherit", lineHeight: 1.45 }}
        placeholder="Paste the email body…" value={form.body} onChange={set("body")} />
      <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
        <button style={{ ...ui.btn, opacity: busy || !form.body.trim() ? 0.5 : 1 }} disabled={busy || !form.body.trim()} onClick={run}>
          {busy ? "Reading…" : "Extract order"}
        </button>
        {error && <span style={{ color: "#991b1b", fontSize: 13 }}>{error}</span>}
      </div>
    </div>
  );
}
