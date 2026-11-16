// Track & trace: loads it scanned (scan mode) or what it read from a carrier reply.
import { ui } from "../styles";

const RISK = { high: ["#fee2e2", "#991b1b", "High"], medium: ["#fef3c7", "#92400e", "Medium"], ok: ["#dcfce7", "#166534", "On track"] };

export default function TraceFindings({ f }) {
  if (f.update) {
    const u = f.update;
    return (
      <div style={ui.grid}>
        {[["Event", u.event_type], ["Location", u.location], ["New ETA", u.eta_date], ["Was due", f.shipment && f.shipment.delivery], ["Reason", u.delay_reason], ["Confidence", `${Math.round((u.confidence || 0) * 100)}%`]].map(([k, v]) => (
          <div key={k} style={ui.kpi}><span style={ui.label}>{k}</span><div style={{ fontWeight: 700 }}>{v || "—"}</div></div>
        ))}
      </div>
    );
  }
  return (
    <table style={ui.table}>
      <thead><tr>{["Load", "Carrier", "Lane", "Status", "Pickup", "Delivery", "Risk"].map((h) => <th key={h} style={ui.th}>{h}</th>)}</tr></thead>
      <tbody>
        {(f.loads || []).map((l) => {
          const [bg, fg, label] = RISK[l.risk.level];
          return (
            <tr key={l.id}>
              <td style={ui.td}>{l.id}</td><td style={ui.td}>{l.carrier}</td><td style={ui.td}>{l.lane}</td><td style={ui.td}>{l.status}</td>
              <td style={ui.td}>{l.pickup || "—"}</td><td style={ui.td}>{l.delivery || "—"}</td>
              <td style={ui.td}><span style={ui.chip(bg, fg)} title={l.risk.reason}>{label}</span> <span style={ui.muted}>{l.risk.level !== "ok" ? l.risk.reason : ""}</span></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
