const defaultActivities = [
  { icon: "✅", text: "Carrier accepted load ORD-546192", time: "12 min ago" },
  { icon: "📅", text: "Dock appointment updated for Dallas DC", time: "28 min ago" },
  { icon: "⚠️", text: "Freight audit flagged invoice mismatch", time: "1 hr ago" },
  { icon: "🛣️", text: "Planner created multi-stop route", time: "2 hrs ago" },
  { icon: "📋", text: "Rate update received from XPO Logistics", time: "3 hrs ago" },
];

export default function ActivityCard({ activities = defaultActivities }) {
  return (
    <div className="card" style={{ padding: 0, height: "100%" }}>
      <div className="card-header">
        <span className="card-title">Recent Activity</span>
      </div>
      <div className="card-body" style={{ padding: "8px 16px 16px" }}>
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
