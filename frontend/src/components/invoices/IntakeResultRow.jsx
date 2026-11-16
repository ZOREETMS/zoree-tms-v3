// One invoice PDF and what Zoree AI did with it (shared by PDF upload and the AP inbox run).
import { outcomeLabel, outcomeTone } from "../../services/invoiceIntakeService";

const TONE = {
  ok: { bg: "rgba(16,185,129,.1)", fg: "#047857" },
  warn: { bg: "rgba(245,158,11,.12)", fg: "#b45309" },
  bad: { bg: "rgba(239,68,68,.1)", fg: "#b91c1c" },
  none: { bg: "#F1F5F9", fg: "#475569" },
};

const money = (n) => (n == null ? "—" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export default function IntakeResultRow({ r }) {
  const tone = TONE[outcomeTone(r)] || TONE.none;
  const notes = [...(r.problems || []), ...((r.issues || []).map((i) => i.detail))];
  return (
    <div style={{ padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <span className="mono" style={{ fontSize: 12 }}>{r.fileName}</span>
        <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: tone.bg, color: tone.fg }}>{outcomeLabel(r)}</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text2)" }}>
          {[r.invoiceNumber, r.carrier, r.shipmentRef, money(r.total)].filter(Boolean).join(" · ")}
        </span>
      </div>
      {r.summary && <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 6 }}>{r.summary}</div>}
      {notes.length > 0 && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--text2)" }}>
          {notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
      {r.passed && r.passed.length > 0 && r.status === "created" && (
        <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>✓ {r.passed.join(" · ")}</div>
      )}
    </div>
  );
}
