/** Portal Summary stats grid — matches the HTML "Portal Summary" card */
export default function PortalStats({ stats }) {
  const items = [
    { label: "Active Customers", value: stats.activeCustomers, color: "var(--accent)" },
    { label: "Shipments Shared", value: stats.shipmentsShared, color: "var(--green)" },
    { label: "In Transit", value: stats.inTransit, color: "var(--yellow)" },
    { label: "Exceptions Visible", value: stats.exceptions, color: "var(--red)" },
  ];

  return (
    <div className="card" style={{ background: "linear-gradient(135deg,rgba(30,45,107,.04),#fff)" }}>
      <div className="card-body" style={{ padding: 20 }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: "var(--text3)",
          textTransform: "uppercase", letterSpacing: 1, marginBottom: 14,
        }}>
          📊 Portal Summary
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {items.map((item) => (
            <div
              key={item.label}
              style={{
                padding: "12px 14px", background: "#f8faff",
                borderRadius: 10, border: "1px solid var(--border)",
              }}
            >
              <div style={{
                fontSize: 10, color: "var(--text3)",
                textTransform: "uppercase", letterSpacing: 0.8,
              }}>
                {item.label}
              </div>
              <div style={{
                fontWeight: 800, fontSize: 20,
                color: item.color, marginTop: 4,
              }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
