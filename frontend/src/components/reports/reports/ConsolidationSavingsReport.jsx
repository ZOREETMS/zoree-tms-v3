import { useMemo } from "react";
import { buildConsolidationSavings } from "../../../services/reportsService";

export default function ConsolidationSavingsReport({ shipments }) {
  const data = useMemo(() => buildConsolidationSavings(shipments), [shipments]);

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
        <div style={{ padding: 16, background: "var(--green-dim)", border: "1px solid var(--green)", borderRadius: 10, textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase" }}>Consolidated Shipments</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "var(--green)", fontFamily: "'Syne',sans-serif" }}>{data.count}</div>
        </div>
        <div style={{ padding: 16, background: "rgba(59,130,246,.08)", border: "1px solid rgba(59,130,246,.2)", borderRadius: 10, textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase" }}>Total Savings MTD</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "var(--accent)", fontFamily: "'Syne',sans-serif" }}>
            ${data.totalSavings.toLocaleString()}
          </div>
        </div>
        <div style={{ padding: 16, background: "var(--yellow-dim)", border: "1px solid rgba(245,158,11,.3)", borderRadius: 10, textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase" }}>Avg Saving/Shipment</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "var(--yellow)", fontFamily: "'Syne',sans-serif" }}>
            ${data.avgSaving.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Shipment rows */}
      {data.rows.map((sh, i) => (
        <div
          key={sh.id}
          style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "10px 14px", background: i % 2 === 0 ? "#f8faff" : "#fff",
            borderRadius: 8, marginBottom: 4,
          }}
        >
          <span className="mono" style={{ color: "var(--accent)", fontWeight: 600 }}>{sh.id}</span>
          <span style={{ fontSize: 12 }}>{sh.origin} &rarr; {sh.dest}</span>
          <span style={{ fontSize: 11, color: "var(--text3)" }}>{sh.orderCount} orders</span>
          <span style={{ marginLeft: "auto", fontWeight: 700, color: "var(--green)" }}>
            -${sh.saving.toLocaleString()}
          </span>
        </div>
      ))}

      {data.rows.length === 0 && (
        <div style={{ color: "var(--text3)", textAlign: "center", padding: 40 }}>No consolidated shipments found</div>
      )}
    </div>
  );
}
