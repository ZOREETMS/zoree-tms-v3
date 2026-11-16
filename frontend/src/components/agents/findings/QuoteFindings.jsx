// What the Quote agent priced: every carrier option per lane, cost vs sell.
import { ui } from "../styles";
import { money } from "../../../services/agentsService";

export default function QuoteFindings({ f }) {
  if (!f.lanes) return f.rfq ? <div style={ui.muted}>{f.rfq.reason || "Not a rate request."}</div> : null;
  return (
    <div>
      <div style={{ ...ui.grid, gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
        <div style={ui.kpi}><span style={ui.label}>Customer</span><div style={{ fontWeight: 700 }}>{f.rfq.customer || "—"}</div><div style={ui.muted}>{f.rfq.contact_email || ""}</div></div>
        <div style={ui.kpi}><span style={ui.label}>Margin rule</span><div style={ui.kpiNum}>{f.margin.pct}%</div><div style={ui.muted}>min {money(f.margin.minUsd)}</div></div>
        <div style={ui.kpi}><span style={ui.label}>EIA diesel</span><div style={ui.kpiNum}>{f.diesel ? `$${f.diesel.price.toFixed(3)}` : "—"}</div><div style={ui.muted}>{f.diesel ? `week of ${f.diesel.week}` : "static fuel %"}</div></div>
        <div style={ui.kpi}><span style={ui.label}>Valid through</span><div style={{ fontWeight: 700 }}>{f.validUntil}</div></div>
      </div>
      {f.lanes.map((l, i) => (
        <div key={i} style={{ marginTop: 12 }}>
          <div style={ui.section}>{l.origin} → {l.dest}{l.weight ? ` · ${Number(l.weight).toLocaleString()} lbs` : ""}{l.laneMiles ? ` · ~${l.laneMiles} mi` : ""} · {l.ratedCarriers} carrier(s) rated</div>
          {l.options.length === 0 ? <div style={ui.warn}>No contract rate on this lane — needs a spot quote.</div> : (
            <table style={ui.table}>
              <thead><tr>{["Carrier", "RPM", "Miles", "Linehaul", "Fuel", "Cost", "Sell", "Margin", "Transit"].map((h) => <th key={h} style={ui.th}>{h}</th>)}</tr></thead>
              <tbody>
                {l.options.map((o, j) => (
                  <tr key={j} style={j === 0 ? { background: "#f0fdf4" } : undefined}>
                    <td style={ui.td}>{j === 0 ? "★ " : ""}{o.carrier}</td>
                    <td style={ui.td}>${o.rpm.toFixed(2)}</td>
                    <td style={ui.td}>{o.miles}</td>
                    <td style={ui.td}>{money(o.base)}</td>
                    <td style={ui.td}>{money(o.fsc)} <span style={ui.chip(o.fscSource === "eia" ? "#e0f2fe" : "#f1f5f9", o.fscSource === "eia" ? "#075985" : "#475569")}>{o.fscPct}% {o.fscSource === "eia" ? "EIA" : "contract"}</span></td>
                    <td style={ui.td}>{money(o.cost)}</td>
                    <td style={{ ...ui.td, fontWeight: 700 }}>{money(o.sell)}</td>
                    <td style={ui.td}>{money(o.marginUsd)}</td>
                    <td style={ui.td}>{o.transitDays ? `${o.transitDays}d` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
      {f.rfq.questions && f.rfq.questions.length > 0 && <div style={ui.warn}>Ask the sender: {f.rfq.questions.join(" · ")}</div>}
    </div>
  );
}
