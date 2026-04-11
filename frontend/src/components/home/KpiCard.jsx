const ICON_MAP = {
  shipments: { icon: "📦", bg: "#DBEAFE" },
  orders: { icon: "🧾", bg: "#DBEAFE" },
  delayed: { icon: "⚠️", bg: "#FEF3C7" },
  savings: { icon: "💰", bg: "#DCFCE7" },
};

export default function KpiCard({ label, value, delta, type = "shipments" }) {
  const { icon, bg } = ICON_MAP[type] || ICON_MAP.shipments;

  return (
    <div className="stat-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className="stat-label">{label}</div>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
      </div>
      <div className="stat-value">{value}</div>
      {delta && <div className="stat-delta">{delta}</div>}
    </div>
  );
}
