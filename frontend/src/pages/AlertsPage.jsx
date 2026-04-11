import useAlerts from "../hooks/useAlerts";
import AlertStats from "../components/alerts/AlertStats";
import AlertFilters from "../components/alerts/AlertFilters";
import AlertList from "../components/alerts/AlertList";

export default function AlertsPage() {
  const {
    alerts,
    stats,
    search,
    setSearch,
    severityFilter,
    setSeverityFilter,
    categoryFilter,
    setCategoryFilter,
    statusFilter,
    setStatusFilter,
    resolveAlert,
    acknowledgeAlert,
  } = useAlerts();

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Alerts & Exceptions</div>
          <div className="page-sub">Active issues requiring attention</div>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary btn-sm">📥 Export Report</button>
        </div>
      </div>

      <div className="page-content">
        <AlertStats stats={stats} />

        <AlertFilters
          search={search}
          onSearchChange={setSearch}
          severity={severityFilter}
          onSeverityChange={setSeverityFilter}
          category={categoryFilter}
          onCategoryChange={setCategoryFilter}
          status={statusFilter}
          onStatusChange={setStatusFilter}
        />

        <AlertList
          alerts={alerts}
          onResolve={resolveAlert}
          onAcknowledge={acknowledgeAlert}
        />
      </div>
    </div>
  );
}
