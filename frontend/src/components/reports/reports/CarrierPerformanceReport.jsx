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
            <th style={thStyle}>Carrier</th>
            <th style={thStyle}>SCAC</th>
            <th style={thStyle}>Mode</th>
            <th style={thStyle}>OTD %</th>
            <th style={thStyle}>Claim Rate</th>
            <th style={thStyle}>Avg Rate</th>
            <th style={thStyle}>Shipments</th>
            <th style={thStyle}>Grade</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.scac || i} style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? "#f8faff" : "#fff" }}>
              <td style={{ ...tdStyle, fontWeight: 600 }}>{r.name}</td>
              <td style={tdStyle} className="mono">{r.scac}</td>
              <td style={tdStyle}><span className="tag">{r.mode}</span></td>
              <td style={{ ...tdStyle, fontWeight: 700, color: otdColor(r.otd) }}>{r.otd}%</td>
              <td style={tdStyle}>{r.claim}%</td>
              <td style={tdStyle} className="mono">${r.avgRate.toFixed(2)}/MI</td>
              <td style={tdStyle} className="mono">{r.shipments}</td>
              <td style={tdStyle}><span style={{ fontWeight: 800, color: gradeColor(r.grade), fontFamily: "'Syne', sans-serif" }}>{r.grade}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
