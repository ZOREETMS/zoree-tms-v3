import { useOutletContext } from "react-router-dom";
import useReports from "../hooks/useReports";
import ReportLibrary from "../components/reports/ReportLibrary";
import ReportOutput from "../components/reports/ReportOutput";

export default function ReportsPage() {
  const { shipments, carriers } = useOutletContext();
  const { activeReport, selectReport, exportReport, reports } = useReports();

  function handleExport(format) {
    const result = exportReport(format);
    if (result) {
      // TODO: replace with real toast system
      alert(`${result.label} exported as ${result.format}`);
    }
  }

  function handleSchedule() {
    // TODO: replace with real scheduling modal
    alert("Report scheduled");
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Reports Workbench</div>
          <div className="page-sub">Custom reports, KPI dashboards, and scheduled exports</div>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary btn-sm" onClick={handleSchedule}>
            Schedule Report
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => activeReport && selectReport(activeReport.id)}
          >
            Run Report
          </button>
        </div>
      </div>

      <div className="page-content">
        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16 }}>
          <ReportLibrary
            reports={reports}
            activeReportId={activeReport?.id}
            onSelect={selectReport}
          />
          <ReportOutput
            activeReport={activeReport}
            onExport={handleExport}
            carriers={carriers}
            shipments={shipments}
          />
        </div>
      </div>
    </div>
  );
}
