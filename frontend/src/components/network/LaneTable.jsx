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
                  <td className="mono">{lane.loads}</td>
                  <td className="mono">${lane.avgCostMi.toFixed(2)}/mi</td>
                  <td className="mono" style={{ color: "var(--text3)" }}>${lane.benchmark.toFixed(2)}/mi</td>
                  <td className="mono" style={{ color: varColor, fontWeight: 700 }}>
                    {variance > 0 ? "+" : ""}{variance}%
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div className="progress-wrap" style={{ width: 60, height: 6 }}>
                        <div className="progress-bar" style={{
                          width: `${lane.util}%`,
                          background: getUtilizationColor(lane.util),
                        }} />
                      </div>
                      <span className="mono" style={{ fontSize: 11 }}>{lane.util}%</span>
                    </div>
                  </td>
                  <td style={{ fontSize: 11, fontWeight: 600, ...oppStyle }}>
                    {lane.opportunity}
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
