export default function AuditStats({ kpis }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
      <div className="stat-card blue">
        <div className="stat-label">Invoices Audited</div>
        <div className="stat-value" style={{ fontSize: 26 }}>{kpis.total}</div>
      </div>
      <div className="stat-card green">
        <div className="stat-label">Matched</div>
        <div className="stat-value" style={{ fontSize: 26 }}>{kpis.matched}</div>
      </div>
      <div className="stat-card red">
        <div className="stat-label">Discrepancies</div>
        <div className="stat-value" style={{ fontSize: 26 }}>{kpis.discrepancies}</div>
      </div>
      <div className="stat-card yellow">
        <div className="stat-label">Pending Review</div>
        <div className="stat-value" style={{ fontSize: 26 }}>{kpis.pendingReview}</div>
      </div>
      <div className="stat-card green">
        <div className="stat-label">Recovered</div>
        <div className="stat-value" style={{ fontSize: 26 }}>${kpis.recovered.toLocaleString()}</div>
      </div>
    </div>
  );
}
