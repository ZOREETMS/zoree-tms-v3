import { useNavigate } from "react-router-dom";
import { SEVERITY_CONFIG, ALERT_STATUS } from "../../types/alerts";
import { formatTimestamp } from "../../utils/formatters";

export default function AlertCard({ alert, onResolve, onAcknowledge }) {
  const navigate = useNavigate();
  const config = SEVERITY_CONFIG[alert.severity];
  const isResolved = alert.status === ALERT_STATUS.RESOLVED;
  const isAcknowledged = alert.status === ALERT_STATUS.ACKNOWLEDGED;

  function handleAction() {
    if (alert.actionRoute) {
      navigate(alert.actionRoute);
    } else if (alert.actionLabel === "Tender All") {
      onResolve(alert.id);
    } else {
      onResolve(alert.id);
    }
  }

  return (
    <div className={`alert alert-${alert.severity}`} style={{ opacity: isResolved ? 0.6 : 1 }}>
      <span className="alert-icon">{config.icon}</span>

      <div className="alert-text" style={{ flex: 1 }}>
        <div className="alert-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {alert.title}
          {alert.reference && (
            <span className="tag" style={{ fontSize: 10 }}>{alert.reference}</span>
          )}
        </div>
        <div>{alert.description}</div>
        <div style={{ marginTop: 4, fontSize: 11, color: "var(--text3)" }}>
          {formatTimestamp(alert.timestamp)}
          {alert.category && <> &middot; {alert.category}</>}
          {alert.status !== ALERT_STATUS.ACTIVE && (
            <span className={`badge ${alert.status === ALERT_STATUS.RESOLVED ? "badge-green" : "badge-amber"}`} style={{ marginLeft: 8 }}>
              {alert.status}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
        {!isResolved && !isAcknowledged && (
          <button className="btn btn-ghost btn-sm" onClick={() => onAcknowledge(alert.id)}>
            Acknowledge
          </button>
        )}
        {!isResolved && alert.actionLabel && (
          <button
            className={`btn btn-sm ${alert.severity === "danger" ? "btn-danger" : alert.severity === "warning" ? "btn-primary" : "btn-secondary"}`}
            onClick={handleAction}
          >
            {alert.actionLabel}
          </button>
        )}
        {!isResolved && !alert.actionLabel && (
          <button className="btn btn-secondary btn-sm" onClick={() => onResolve(alert.id)}>
            Resolve
          </button>
        )}
      </div>
    </div>
  );
}
