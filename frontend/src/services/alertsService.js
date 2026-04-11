import { ALERT_SEVERITY, ALERT_CATEGORY, ALERT_STATUS } from "../types/alerts";

const SEED_ALERTS = [
  {
    id: "ALT-001",
    title: "Delivery Delay — SHP-2024-1847",
    description: "Chicago to Dallas est. 6 hours late. Carrier: Swift Transport.",
    severity: ALERT_SEVERITY.DANGER,
    category: ALERT_CATEGORY.DELIVERY,
    status: ALERT_STATUS.ACTIVE,
    reference: "SHP-2024-1847",
    timestamp: "2026-03-30T08:15:00",
    actionLabel: "Resolve",
    actionRoute: "",
  },
  {
    id: "ALT-002",
    title: "Rate Discrepancy — INV-84423",
    description: "JB Hunt invoiced $3,070 vs agreed $2,750. Variance $320.",
    severity: ALERT_SEVERITY.DANGER,
    category: ALERT_CATEGORY.RATE,
    status: ALERT_STATUS.ACTIVE,
    reference: "INV-84423",
    timestamp: "2026-03-30T07:42:00",
    actionLabel: "Review",
    actionRoute: "/freight-invoices",
  },
  {
    id: "ALT-003",
    title: "3 Shipments Due for Tendering Today",
    description: "SHP-2024-1843, 1846, 1852 should be tendered by 5:00 PM CST.",
    severity: ALERT_SEVERITY.WARNING,
    category: ALERT_CATEGORY.TENDERING,
    status: ALERT_STATUS.ACTIVE,
    reference: "",
    timestamp: "2026-03-30T06:00:00",
    actionLabel: "Tender All",
    actionRoute: "",
  },
  {
    id: "ALT-004",
    title: "Freight Spend Over Budget (MTD)",
    description: "Current spend 4.3% over monthly budget. Driver: increased TL rates on CHI-DAL lane.",
    severity: ALERT_SEVERITY.INFO,
    category: ALERT_CATEGORY.BUDGET,
    status: ALERT_STATUS.ACTIVE,
    reference: "",
    timestamp: "2026-03-30T05:30:00",
    actionLabel: "",
    actionRoute: "",
  },
  {
    id: "ALT-005",
    title: "HOS Violation — David Chen (TRK-103)",
    description: "Exceeded 11-hour driving limit. Current: 11.1 hrs. Must take mandatory rest.",
    severity: ALERT_SEVERITY.DANGER,
    category: ALERT_CATEGORY.COMPLIANCE,
    status: ALERT_STATUS.ACTIVE,
    reference: "TRK-103",
    timestamp: "2026-03-30T09:10:00",
    actionLabel: "View Compliance",
    actionRoute: "/compliance",
  },
  {
    id: "ALT-006",
    title: "Carrier Insurance Expiring — Werner",
    description: "Werner Enterprises liability insurance expires in 15 days. Renewal required.",
    severity: ALERT_SEVERITY.WARNING,
    category: ALERT_CATEGORY.CARRIER,
    status: ALERT_STATUS.ACTIVE,
    reference: "Werner",
    timestamp: "2026-03-29T14:00:00",
    actionLabel: "View Carrier",
    actionRoute: "/carriers",
  },
  {
    id: "ALT-007",
    title: "Overweight Shipment — SHP-2024-1851",
    description: "Weight 81,200 lbs exceeds 80,000 limit. Oversize permit required.",
    severity: ALERT_SEVERITY.WARNING,
    category: ALERT_CATEGORY.COMPLIANCE,
    status: ALERT_STATUS.ACKNOWLEDGED,
    reference: "SHP-2024-1851",
    timestamp: "2026-03-29T11:20:00",
    actionLabel: "View Shipment",
    actionRoute: "/shipments",
  },
  {
    id: "ALT-008",
    title: "Delivery Confirmed — SHP-2024-1840",
    description: "Atlanta to Miami delivered on time. POD received.",
    severity: ALERT_SEVERITY.SUCCESS,
    category: ALERT_CATEGORY.DELIVERY,
    status: ALERT_STATUS.RESOLVED,
    reference: "SHP-2024-1840",
    timestamp: "2026-03-29T09:45:00",
    actionLabel: "",
    actionRoute: "",
  },
];

export function getAlerts() {
  return SEED_ALERTS;
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
