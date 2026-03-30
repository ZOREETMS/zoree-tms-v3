import { useMemo } from "react";
import { buildFreightSpend } from "../../../services/reportsService";

export default function FreightSpendReport({ shipments }) {
  const data = useMemo(() => buildFreightSpend(shipments), [shipments]);

  return (
    <div>
      {/* Total spend card */}
      <div style={{
        padding: 16, background: "var(--green-dim)", border: "1px solid var(--green)",
        borderRadius: 10, textAlign: "center", marginBottom: 20,
      }}>
        <div style={{ fontSize: 11, color: "var(--text3)" }}>Total Freight Spend MTD</div>
        <div style={{ fontSize: 32, fontWeight: 800, color: "var(--green)", fontFamily: "'Syne',sans-serif" }}>
          ${data.total.toLocaleString()}
        </div>
      </div>

      {/* Breakdown by carrier */}
      {data.breakdown.map((entry) => (
        <div key={entry.name} style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{entry.name}</span>
            <span className="mono" style={{ fontSize: 13 }}>
              ${entry.amount.toLocaleString()} ({entry.pct}%)
            </span>
          </div>
          <div className="progress-wrap" style={{ height: 8 }}>
            <div className="progress-bar" style={{ width: `${entry.pct}%` }} />
          </div>
        </div>
      ))}

      {data.breakdown.length === 0 && (
        <div style={{ color: "var(--text3)", textAlign: "center", padding: 40 }}>No freight spend data available</div>
      )}
    </div>
  );
}
