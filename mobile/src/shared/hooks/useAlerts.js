import { useState, useMemo, useCallback } from "react";
import { getAlerts, computeAlertStats, filterAlerts } from "../services/alertsService";
import { ALERT_STATUS } from "../types/alerts";

export default function useAlerts() {
  const [alerts, setAlerts] = useState(() => getAlerts());
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const stats = useMemo(() => computeAlertStats(alerts), [alerts]);

  const filtered = useMemo(
    () => filterAlerts(alerts, { search, severity: severityFilter, category: categoryFilter, status: statusFilter }),
    [alerts, search, severityFilter, categoryFilter, statusFilter]
  );

  const resolveAlert = useCallback((id) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: ALERT_STATUS.RESOLVED } : a))
    );
  }, []);

  const acknowledgeAlert = useCallback((id) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: ALERT_STATUS.ACKNOWLEDGED } : a))
    );
  }, []);

  return {
    alerts: filtered,
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
  };
}
