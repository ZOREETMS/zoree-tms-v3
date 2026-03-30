import { useMemo } from "react";
import { buildCarrierPerformance } from "../../../services/reportsService";

function gradeColor(grade) {
  if (grade === "A") return "var(--green)";
  if (grade === "B") return "var(--yellow)";
  return "var(--red)";
}

function otdColor(otd) {
  if (otd > 95) return "var(--green)";
  if (otd > 90) return "var(--yellow)";
  return "var(--red)";
}

export default function CarrierPerformanceReport({ carriers, shipments }) {
  const rows = useMemo(() => buildCarrierPerformance(carriers, shipments), [carriers, shipments]);

  if (rows.length === 0) {
    return <div style={{ color: "var(--text3)", textAlign: "center", padding: 40 }}>No carrier data available</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Carrier</th>
            <th>SCAC</th>
            <th>Mode</th>
            <th>OTD %</th>
            <th>Claim Rate</th>
            <th>Avg Rate</th>
            <th>Shipments</th>
            <th>Grade</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.scac || i} style={{ background: i % 2 === 0 ? "#f8faff" : "#fff" }}>
              <td style={{ fontWeight: 600 }}>{r.name}</td>
              <td className="mono">{r.scac}</td>
              <td><span className="tag">{r.mode}</span></td>
              <td style={{ fontWeight: 700, color: otdColor(r.otd) }}>{r.otd}%</td>
              <td>{r.claim}%</td>
              <td className="mono">${r.avgRate.toFixed(2)}/mi</td>
              <td className="mono">{r.shipments}</td>
              <td><span style={{ fontWeight: 800, color: gradeColor(r.grade) }}>{r.grade}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
