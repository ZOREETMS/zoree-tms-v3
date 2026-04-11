export const ALERT_SEVERITY = {
  DANGER: "danger",
  WARNING: "warning",
  INFO: "info",
  SUCCESS: "success",
};

export const ALERT_CATEGORY = {
  DELIVERY: "Delivery",
  RATE: "Rate",
  TENDERING: "Tendering",
  BUDGET: "Budget",
  COMPLIANCE: "Compliance",
  CARRIER: "Carrier",
};

export const ALERT_STATUS = {
  ACTIVE: "Active",
  ACKNOWLEDGED: "Acknowledged",
  RESOLVED: "Resolved",
};

export const SEVERITY_CONFIG = {
  [ALERT_SEVERITY.DANGER]:  { icon: "\uD83D\uDEA8", label: "Critical",  badgeClass: "badge-red" },
  [ALERT_SEVERITY.WARNING]: { icon: "\u26A0\uFE0F", label: "Warning",   badgeClass: "badge-amber" },
  [ALERT_SEVERITY.INFO]:    { icon: "\u2139\uFE0F", label: "Info",      badgeClass: "badge-blue" },
  [ALERT_SEVERITY.SUCCESS]: { icon: "\u2705",       label: "Resolved",  badgeClass: "badge-green" },
};

export function emptyAlert() {
  return {
    id: "",
    title: "",
    description: "",
    severity: ALERT_SEVERITY.INFO,
    category: ALERT_CATEGORY.DELIVERY,
    status: ALERT_STATUS.ACTIVE,
    reference: "",
    timestamp: "",
    actionLabel: "",
    actionRoute: "",
  };
}
