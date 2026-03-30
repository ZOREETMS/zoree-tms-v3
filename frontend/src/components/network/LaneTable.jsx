import { getVarianceColor, getOpportunityStyle, getUtilizationColor } from "../../services/networkService";

export default function LaneTable({ lanes }) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Lane Performance Matrix</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Lane</th>
              <th>Loads/Mo</th>
              <th>Avg Cost/Mile</th>
              <th>Benchmark</th>
              <th>Variance</th>
              <th>Util %</th>
              <th>Opportunity</th>
            </tr>
          </thead>
          <tbody>
            {lanes.map((lane) => {
              const variance = ((lane.avgCostMi - lane.benchmark) / lane.benchmark * 100).toFixed(1);
              const varColor = getVarianceColor(lane.avgCostMi, lane.benchmark);
              const oppStyle = getOpportunityStyle(lane.opportunity);

              return (
                <tr key={lane.lane}>
                  <td style={{ fontWeight: 600 }}>{lane.lane}</td>
                  <td>{lane.loads}</td>
                  <td>${lane.avgCostMi.toFixed(2)}</td>
                  <td>${lane.benchmark.toFixed(2)}</td>
                  <td style={{ color: varColor, fontWeight: 600 }}>
                    {variance > 0 ? "+" : ""}{variance}%
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 6, background: "#e2e8f0", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{
                          width: `${lane.util}%`,
                          height: "100%",
                          borderRadius: 3,
                          background: getUtilizationColor(lane.util),
                        }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, minWidth: 32 }}>{lane.util}%</span>
                    </div>
                  </td>
                  <td>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 8,
                      ...oppStyle,
                    }}>
                      {lane.opportunity === "High" ? "🔴 Rebid" : lane.opportunity === "Medium" ? "🟡 Review" : "✅ OK"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
