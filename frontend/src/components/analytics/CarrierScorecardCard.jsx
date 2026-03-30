import { GRADE_COLORS } from "../../types/analytics";

export default function CarrierScorecardCard({ carriers }) {
  if (!carriers.length) {
    return (
      <div className="card">
        <div className="card-header">
          <span className="card-title">Carrier Scorecard</span>
        </div>
        <div className="card-body" style={{ color: "var(--text3)" }}>
          No carrier data available
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Carrier Scorecard</span>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Carrier</th>
              <th>OTD%</th>
              <th>Claims</th>
              <th>Grade</th>
            </tr>
          </thead>
          <tbody>
            {carriers.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td className="mono">{c.otd}%</td>
                <td className="mono">{c.claims}%</td>
                <td
                  style={{
                    color: GRADE_COLORS[c.grade],
                    fontWeight: 700,
                    fontFamily: "'Syne', sans-serif",
                  }}
                >
                  {c.grade}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
