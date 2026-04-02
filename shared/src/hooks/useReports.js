import { useState, useCallback } from "react";
import { REPORT_DEFS } from "../types/reports";

export default function useReports() {
  const [activeReportId, setActiveReportId] = useState(null);

  const activeReport = REPORT_DEFS.find((r) => r.id === activeReportId) || null;

  const selectReport = useCallback((id) => {
    setActiveReportId(id);
  }, []);

  const exportReport = useCallback((format) => {
    if (!activeReport) return;
    // Placeholder — in production this calls an API endpoint
    return { label: activeReport.label, format: format.toUpperCase() };
  }, [activeReport]);

  return { activeReport, selectReport, exportReport, reports: REPORT_DEFS };
}
