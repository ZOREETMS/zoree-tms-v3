export default function AlertStats({ stats }) {
  return (
    <div className="stat-grid">
      <div className="stat-card red">
        <div className="stat-label">Critical</div>
        <div className="stat-value">{stats.critical}</div>
        <div className="text-sm text-muted">Require immediate action</div>
      </div>
      <div className="stat-card yellow">
        <div className="stat-label">Warnings</div>
        <div className="stat-value">{stats.warnings}</div>
        <div className="text-sm text-muted">Needs attention</div>
      </div>
      <div className="stat-card blue">
        <div className="stat-label">Informational</div>
        <div className="stat-value">{stats.info}</div>
        <div className="text-sm text-muted">For awareness</div>
      </div>
      <div className="stat-card green">
        <div className="stat-label">Resolved</div>
        <div className="stat-value">{stats.resolved}</div>
        <div className="text-sm text-muted">Cleared this period</div>
      </div>
    </div>
  );
}
