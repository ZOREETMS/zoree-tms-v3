import CarrierPerformanceReport from "./reports/CarrierPerformanceReport";
import LaneCostReport from "./reports/LaneCostReport";
import OnTimeDeliveryReport from "./reports/OnTimeDeliveryReport";
import FreightSpendReport from "./reports/FreightSpendReport";
import ConsolidationSavingsReport from "./reports/ConsolidationSavingsReport";
import SustainabilityReport from "./reports/SustainabilityReport";
import PlaceholderReport from "./reports/PlaceholderReport";

const REPORT_MAP = {
  "carrier-perf": CarrierPerformanceReport,
  "lane-cost": LaneCostReport,
  "on-time": OnTimeDeliveryReport,
  "freight-spend": FreightSpendReport,
  "consolidation": ConsolidationSavingsReport,
  "sustainability": SustainabilityReport,
};

export default function ReportOutput({ activeReport, onExport, carriers, shipments }) {
  if (!activeReport) {
    return (
      <div className="card">
        <div className="card-header">
          <span className="card-title">Select a report</span>
        </div>
        <div style={{ padding: 40, textAlign: "center", color: "var(--text3)", minHeight: 300 }}>
          &larr; Select a report from the library
        </div>
      </div>
    );
  }

  const ReportComponent = REPORT_MAP[activeReport.id] || PlaceholderReport;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">{activeReport.icon} {activeReport.label}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => onExport("csv")}>
            Export CSV
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => onExport("pdf")}>
            Export PDF
          </button>
        </div>
      </div>
      <div style={{ padding: 20, minHeight: 300 }}>
        <ReportComponent carriers={carriers} shipments={shipments} />
      </div>
    </div>
  );
}
