import { STATUS_COLORS, HOS_MAX_HOURS } from "../../types/compliance";
import { getHosPct } from "../../services/complianceService";

export default function HosComplianceCard({ hosRecords }) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">HOS Compliance</span>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        {hosRecords.map((h, i) => {
          const { color, bg } = STATUS_COLORS[h.status] || STATUS_COLORS.OK;
          const pct = getHosPct(h.hoursToday);

          return (
            <div key={i} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{h.driver}</span>
                <StatusBadge label={h.status} color={color} bg={bg} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div className="progress-wrap" style={{ flex: 1, height: 6 }}>
                  <div className="progress-bar" style={{ width: `${pct}%`, background: color }} />
                </div>
                <span className="mono" style={{ fontSize: 11, color: "var(--text3)", minWidth: 80 }}>
                  {h.hoursToday}h / {HOS_MAX_HOURS}h max
                </span>
              </div>
              {h.violation && (
                <div style={{ fontSize: 11, color: "var(--red)", marginTop: 4 }}>
                  ⚠️ {h.violation}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ label, color, bg }) {
  return (
    <span style={{
      fontSize: 11, background: bg, color, border: `1px solid ${color}`,
      padding: "2px 8px", borderRadius: 10, fontWeight: 600,
    }}>
      {label}
    </span>
  );
}
