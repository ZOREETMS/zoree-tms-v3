import { STATUS_COLORS } from "../../types/compliance";

export default function WeightChecksCard({ weightRecords }) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Weight & Dimension Checks</span>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        {weightRecords.map((w, i) => {
          const { color, bg } = STATUS_COLORS[w.status] || STATUS_COLORS.Pass;

          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
              <span className="mono" style={{ color: "var(--accent)", fontSize: 12, fontWeight: 600 }}>{w.ship}</span>
              <span className="mono" style={{ fontSize: 12 }}>{w.weight.toLocaleString()} lbs</span>
              {w.permitReq && (
                <span style={{
                  fontSize: 10, background: "rgba(245,158,11,.1)", color: "var(--yellow)",
                  border: "1px solid rgba(245,158,11,.25)", padding: "2px 7px", borderRadius: 8,
                }}>
                  Permit Req.
                </span>
              )}
              <span style={{
                marginLeft: "auto", fontSize: 11, background: bg, color,
                border: `1px solid ${color}`, padding: "2px 9px", borderRadius: 10, fontWeight: 600,
              }}>
                {w.status}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
