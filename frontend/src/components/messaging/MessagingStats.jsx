export default function MessagingStats({ kpis }) {
  const cards = [
    { label: "Total Messages", value: kpis.total, cls: "blue" },
    { label: "Delivered", value: kpis.delivered, cls: "green" },
    { label: "Outbound", value: kpis.outbound, cls: "blue" },
    { label: "Inbound", value: kpis.inbound, cls: "blue" },
    { label: "Failed", value: kpis.failed, cls: "red" },
    { label: "Pending", value: kpis.pending, cls: "yellow" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 20 }}>
      {cards.map((c) => (
        <div className={`stat-card ${c.cls}`} key={c.label}>
          <div className="stat-label">{c.label}</div>
          <div className="stat-value" style={{ fontSize: 24 }}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}
