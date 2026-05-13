import useAlerts from "../hooks/useAlerts";
import AlertStats from "../components/alerts/AlertStats";
import AlertFilters from "../components/alerts/AlertFilters";
import AlertList from "../components/alerts/AlertList";
// QA 252/255 (2026-05-12): Finance / Viewer have view-only access to
// Alerts & Exceptions but Tender All / Resolve / Acknowledge were
// unconditional. Gate via useFeatureAccess.
import { useFeatureAccess } from "../hooks/useFeatureAccess";

export default function AlertsPage() {
  const { canEdit: canEditAlerts } = useFeatureAccess("alerts");
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
          onResolve={canEditAlerts ? resolveAlert : null}
          onAcknowledge={canEditAlerts ? acknowledgeAlert : null}
          canEdit={canEditAlerts}
        />
      </div>
    </div>
  );
}
