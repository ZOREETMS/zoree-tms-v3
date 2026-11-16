// How the Carrier Sourcing agent ranked carriers for each load.
import { ui } from "../styles";

export default function SourcingFindings({ f }) {
  return (f.shipments || []).map(({ shipment: s, ranked, eligibleCount }) => (
    <div key={s.id} style={{ marginTop: 6 }}>
      <div style={ui.section}>{s.id} · {s.origin} → {s.dest} · {Number(s.weight || 0).toLocaleString()} lbs {s.mode} · pickup {s.pickup_date || "TBD"} · {eligibleCount} eligible carrier(s)</div>
      <table style={ui.table}>
        <thead><tr>{["#", "Carrier", "Score", "Why"].map((h) => <th key={h} style={ui.th}>{h}</th>)}</tr></thead>
        <tbody>
          {ranked.map((c, i) => (
            <tr key={c.carrier}>
              <td style={ui.td}>{i + 1}</td>
              <td style={{ ...ui.td, fontWeight: 600 }}>{c.carrier}</td>
              <td style={{ ...ui.td, width: 130 }}><div style={{ fontWeight: 700 }}>{c.score}</div><div style={ui.scoreBar(c.score, i === 0 ? "#16a34a" : "#64748b")} /></td>
              <td style={{ ...ui.td, color: "#475569" }}>{c.reasons.join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ));
}
