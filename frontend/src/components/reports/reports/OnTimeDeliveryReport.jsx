import { useMemo } from "react";
import { buildOnTimeDelivery } from "../../../services/reportsService";

function otdBarColor(otd) {
  if (otd > 95) return "var(--green)";
  if (otd > 90) return "var(--yellow)";
  return "var(--red)";
}

export default function OnTimeDeliveryReport({ carriers, shipments }) {
  const data = useMemo(() => buildOnTimeDelivery(carriers, shipments), [carriers, shipments]);

  if (data.rows.length === 0) {
    return <div style={{ color: "var(--text3)", textAlign: "center", padding: 40 }}>No carrier data available</div>;
  }

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
        <div style={{ padding: 16, background: "var(--green-dim)", border: "1px solid var(--green)", borderRadius: 10, textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase" }}>Network OTD Avg</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "var(--green)", fontFamily: "'Syne',sans-serif" }}>{data.avg}%</div>
        </div>
        <div style={{ padding: 16, background: "rgba(59,130,246,.08)", border: "1px solid rgba(59,130,246,.2)", borderRadius: 10, textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase" }}>Best Carrier</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--accent)" }}>{data.best}</div>
        </div>
        <div style={{ padding: 16, background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.2)", borderRadius: 10, textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase" }}>Needs Improvement</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--yellow)" }}>{data.worst}</div>
        </div>
      </div>

      {/* Bar rows */}
      {data.rows.map((c, i) => (
        <div
          key={c.name}
          style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "10px 14px", background: i % 2 === 0 ? "#f8faff" : "#fff",
            borderRadius: 8, marginBottom: 4,
          }}
        >
          <div style={{ fontWeight: 600, minWidth: 160 }}>{c.name}</div>
          <div className="progress-wrap" style={{ flex: 1, height: 10 }}>
            <div className="progress-bar" style={{ width: `${c.otd}%`, background: otdBarColor(c.otd) }} />
          </div>
          <div className="mono" style={{ fontWeight: 700, minWidth: 50 }}>{c.otd}%</div>
        </div>
      ))}
    </div>
  );
}
