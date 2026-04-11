export default function AppointmentCard({ appointment }) {
  const a = appointment;
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span className={`badge ${a.type === "Inbound" ? "badge-blue" : "badge-green"}`} style={{ fontSize: 10 }}>
          {a.type.toUpperCase()}
        </span>
        <strong>{a.door}</strong>
        <span className="badge badge-planned" style={{ fontSize: 10, marginLeft: "auto" }}>• {a.status}</span>
      </div>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{a.carrier || "TBD"}</div>
      <div style={{ fontSize: 12, color: "var(--text3)" }}>
        🕐 {a.start} – {a.duration}min
        {a.shipmentId && <> · 📦 <span style={{ color: "var(--accent)" }}>{a.shipmentId}</span></>}
      </div>
    </div>
  );
}
