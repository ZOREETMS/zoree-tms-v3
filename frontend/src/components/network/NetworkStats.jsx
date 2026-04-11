import { formatCurrency } from "../../utils/formatters";

export default function NetworkStats({ kpis }) {

  const cards = [
    { label: "Active Lanes", value: kpis.active, cls: "blue" },
    { label: "Optimized Lanes", value: kpis.optimized, cls: "green" },
    { label: "Under-utilized", value: kpis.underUtilized, cls: "yellow" },
    { label: "Potential Annual Savings", value: formatCurrency(kpis.savings), cls: "green" },
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
