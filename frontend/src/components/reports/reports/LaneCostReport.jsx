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

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Lane</th>
            <th>Loads/Mo</th>
            <th>Avg Cost/Mi</th>
            <th>Benchmark</th>
            <th>Variance</th>
            <th>Utilization</th>
            <th>Opportunity</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.lane} style={{ background: i % 2 === 0 ? "#f8faff" : "#fff" }}>
              <td style={{ fontWeight: 600 }}>{r.lane}</td>
              <td className="mono">{r.loads}</td>
              <td className="mono">${r.avgCostMi.toFixed(2)}</td>
              <td className="mono" style={{ color: "var(--text3)" }}>${r.benchmark.toFixed(2)}</td>
              <td style={{ fontWeight: 700, color: varianceColor(r.variance) }}>
                {r.variance > 0 ? "+" : ""}{r.variance}%
              </td>
              <td className="mono">{r.util}%</td>
              <td style={{ fontSize: 12, color: opportunityColor(r.opportunity) }}>{r.opportunity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
