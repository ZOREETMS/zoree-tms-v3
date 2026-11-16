export default function ActivityCard({ activities = [] }) {
  return (
    <div className="card" style={{ padding: 0, height: "100%" }}>
      <div className="card-header">
        <span className="card-title">Recent Activity</span>
      </div>
      <div className="card-body" style={{ padding: "8px 16px 16px" }}>
        {activities.length === 0 && (
          <div className="activity-time" style={{ padding: "12px 0" }}>No recent activity</div>
        )}
        {activities.map((item, i) => (
          <div className="activity-item" key={i}>
            <div className="activity-icon-wrap">{item.icon}</div>
            <div style={{ flex: 1 }}>
              <div className="activity-text">{item.text}</div>
              <div className="activity-time">{item.time}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
