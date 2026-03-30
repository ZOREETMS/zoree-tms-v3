export default function NetworkStats({ kpis }) {
  const fmt = (n) => n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n)}`;

  const cards = [
    { label: "Active Lanes", value: kpis.active, cls: "blue" },
    { label: "Optimized Lanes", value: kpis.optimized, cls: "green" },
    { label: "Under-utilized", value: kpis.underUtilized, cls: "yellow" },
    { label: "Potential Annual Savings", value: fmt(kpis.savings), cls: "green" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
      {cards.map((c) => (
        <div className={`stat-card ${c.cls}`} key={c.label}>
          <div className="stat-label">{c.label}</div>
          <div className="stat-value" style={{ fontSize: c.label.includes("Savings") ? 20 : 26 }}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}
