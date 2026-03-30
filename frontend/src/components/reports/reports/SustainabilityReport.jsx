import { useMemo } from "react";
import { buildSustainability } from "../../../services/reportsService";

export default function SustainabilityReport({ carriers, shipments }) {
  const data = useMemo(() => buildSustainability(carriers, shipments), [carriers, shipments]);

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
        {[
          { label: "CO\u2082 Emitted MTD", value: `${data.co2kg.toLocaleString()} kg` },
          { label: "Total Miles Driven", value: `${data.totalMiles.toLocaleString()} mi` },
          { label: "Saved via Consolidation", value: `~${data.savedViaConsolidation.toLocaleString()} kg` },
        ].map((card) => (
          <div key={card.label} style={{
            padding: 16, background: "rgba(16,185,129,.08)", border: "1px solid var(--green)",
            borderRadius: 10, textAlign: "center",
          }}>
            <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase" }}>{card.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "var(--green)", fontFamily: "'Syne',sans-serif" }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Carrier breakdown */}
      {data.byCarrier.map((car) => {
        const pct = data.totalMiles > 0 ? Math.min(100, Math.round((car.miles / data.totalMiles) * 100)) : 0;
        return (
          <div key={car.name} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{car.name}</span>
              <span className="mono" style={{ fontSize: 12, color: "var(--green)" }}>
                {car.co2.toLocaleString()} kg CO&#8322;
              </span>
            </div>
            <div className="progress-wrap" style={{ height: 7 }}>
              <div className="progress-bar" style={{ width: `${pct}%`, background: "var(--green)" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
