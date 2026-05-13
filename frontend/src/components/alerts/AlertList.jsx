import AlertCard from "./AlertCard";

// QA 252/255 (2026-05-12): `canEdit` defaults to true and is forwarded
// to each AlertCard so view-only roles cannot mutate alert state.
export default function AlertList({ alerts, onResolve, onAcknowledge, canEdit = true }) {
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
          canEdit={canEdit}
        />
      ))}
    </div>
  );
}
