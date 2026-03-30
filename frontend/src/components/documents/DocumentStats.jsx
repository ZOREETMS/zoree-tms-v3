export default function DocumentStats({ stats }) {
  const cards = [
    { label: "Total Documents", value: stats.total, color: "blue" },
    { label: "BOLs Generated", value: stats.bolsGenerated, color: "green" },
    { label: "PODs Pending", value: stats.podsPending, color: "yellow" },
    { label: "POD Received", value: stats.podsReceived, color: "green" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
      {cards.map((c) => (
        <div key={c.label} className={`stat-card ${c.color}`}>
          <div className="stat-label">{c.label}</div>
          <div className="stat-value" style={{ fontSize: 26 }}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}
