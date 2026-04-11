import { useMemo } from "react";
import { buildLaneCostAnalysis } from "../../../services/reportsService";

function varianceColor(v) {
  if (v > 5) return "var(--red)";
  if (v < -5) return "var(--green)";
  return "var(--yellow)";
}

function opportunityColor(opp) {
  if (opp.startsWith("High")) return "var(--red)";
  if (opp.startsWith("Med")) return "var(--yellow)";
  return "var(--green)";
}

export default function LaneCostReport() {
  const rows = useMemo(() => buildLaneCostAnalysis(), []);

  const thStyle = {
    textAlign: "left", padding: "8px 12px", fontSize: 11,
    textTransform: "uppercase", color: "var(--text3)", letterSpacing: ".5px",
    whiteSpace: "nowrap",
  };

  const tdStyle = { padding: "9px 12px" };

  return (
    <div className="table-wrap">
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--border)" }}>
            <th style={thStyle}>Lane</th>
            <th style={thStyle}>Loads/Mo</th>
            <th style={thStyle}>Avg Cost/Mi</th>
            <th style={thStyle}>Benchmark</th>
            <th style={thStyle}>Variance</th>
            <th style={thStyle}>Utilization</th>
            <th style={thStyle}>Opportunity</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.lane} style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? "#f8faff" : "#fff" }}>
              <td style={{ ...tdStyle, fontWeight: 600 }}>{r.lane}</td>
              <td style={tdStyle} className="mono">{r.loads}</td>
              <td style={tdStyle} className="mono">${r.avgCostMi.toFixed(2)}</td>
              <td style={{ ...tdStyle, color: "var(--text3)" }} className="mono">${r.benchmark.toFixed(2)}</td>
              <td style={{ ...tdStyle, fontWeight: 700, color: varianceColor(r.variance) }}>
                {r.variance > 0 ? "+" : ""}{r.variance}%
              </td>
              <td style={tdStyle} className="mono">{r.util}%</td>
              <td style={{ ...tdStyle, fontSize: 12, color: opportunityColor(r.opportunity) }}>{r.opportunity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
