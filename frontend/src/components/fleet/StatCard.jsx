const COLOR_MAP = {
  blue: "stat-card blue",
  green: "stat-card green",
  yellow: "stat-card yellow",
  red: "stat-card red",
};

export default function StatCard({ label, value, color = "blue" }) {
  return (
    <div className={COLOR_MAP[color] || "stat-card blue"}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ fontSize: 26 }}>
        {value ?? "\u2014"}
      </div>
    </div>
  );
}
