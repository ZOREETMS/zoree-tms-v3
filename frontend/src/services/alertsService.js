import { ALERT_SEVERITY, ALERT_CATEGORY, ALERT_STATUS } from "../types/alerts";

// No alert feed exists in the API yet — the list is empty until one does.
export function getAlerts() {
  return [];
}

export function computeAlertStats(alerts) {
  const active = alerts.filter((a) => a.status === ALERT_STATUS.ACTIVE);
  const critical = active.filter((a) => a.severity === ALERT_SEVERITY.DANGER).length;
  const warnings = active.filter((a) => a.severity === ALERT_SEVERITY.WARNING).length;
  const info = active.filter((a) => a.severity === ALERT_SEVERITY.INFO).length;
  const resolved = alerts.filter((a) => a.status === ALERT_STATUS.RESOLVED).length;

  return { total: active.length, critical, warnings, info, resolved };
}

export function filterAlerts(alerts, { search, severity, category, status }) {
  let result = alerts;

  if (search) {
    const q = search.toLowerCase();
    result = result.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.reference.toLowerCase().includes(q)
    );
  }

  if (severity) {
    result = result.filter((a) => a.severity === severity);
  }

  if (category) {
    result = result.filter((a) => a.category === category);
  }

  if (status) {
    result = result.filter((a) => a.status === status);
  }

  return result;
}
