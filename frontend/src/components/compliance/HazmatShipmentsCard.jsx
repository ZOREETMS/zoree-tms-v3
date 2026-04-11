import { STATUS_COLORS } from "../../types/compliance";

export default function HazmatShipmentsCard({ hazmatRecords }) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Hazmat Shipments</span>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        {hazmatRecords.map((h, i) => {
          const { color, bg } = STATUS_COLORS[h.status] || STATUS_COLORS.Warning;

          return (
            <div key={i} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <span className="mono" style={{ color: "var(--accent)", fontSize: 12 }}>{h.ship}</span>
                <span style={{
                  fontSize: 11, background: bg, color, border: `1px solid ${color}`,
                  padding: "2px 9px", borderRadius: 10, fontWeight: 600,
                }}>
                  {h.status}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--text2)" }}>{h.class}</div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                {h.carrier} · Placard: {h.placardOk ? "✅ OK" : "⚠️ Needed"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
