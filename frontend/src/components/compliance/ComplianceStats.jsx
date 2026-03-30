export default function ComplianceStats({ stats }) {
  return (
    <div className="stat-grid">
      <div className="stat-card green">
        <div className="stat-label">Compliant Shipments</div>
        <div className="stat-value" style={{ fontSize: 26 }}>{stats.compliantPct}%</div>
      </div>
      <div className="stat-card yellow">
        <div className="stat-label">HOS Warnings</div>
        <div className="stat-value" style={{ fontSize: 26 }}>{stats.hosWarnings}</div>
      </div>
      <div className="stat-card red">
        <div className="stat-label">Violations</div>
        <div className="stat-value" style={{ fontSize: 26 }}>{stats.violations}</div>
      </div>
      <div className="stat-card blue">
        <div className="stat-label">Hazmat Shipments</div>
        <div className="stat-value" style={{ fontSize: 26 }}>{stats.hazmatShipments}</div>
      </div>
    </div>
  );
}
