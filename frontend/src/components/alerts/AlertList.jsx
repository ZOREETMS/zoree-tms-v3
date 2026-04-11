import AlertCard from "./AlertCard";

export default function AlertList({ alerts, onResolve, onAcknowledge }) {
  if (alerts.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🔔</div>
        <div className="empty-state-title">No Alerts Found</div>
        <div className="empty-state-desc">No alerts match your current filters.</div>
      </div>
    );
  }

  return (
    <div>
      {alerts.map((alert) => (
        <AlertCard
          key={alert.id}
          alert={alert}
          onResolve={onResolve}
          onAcknowledge={onAcknowledge}
        />
      ))}
    </div>
  );
}
