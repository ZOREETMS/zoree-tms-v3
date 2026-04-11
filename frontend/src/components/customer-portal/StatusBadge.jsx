/** Reusable status badge matching the TMS badge styles */
const STATUS_CLASS_MAP = {
  "Planned": "badge-planned",
  "Tendered": "badge-tendered",
  "Confirmed": "badge-confirmed",
  "In Transit": "badge-intransit",
  "Delivered": "badge-delivered",
  "Exception": "badge-exception",
  "Cancelled": "badge-cancelled",
  "Consolidated": "badge-consolidated",
  "Unplanned": "badge-unplanned",
};

export default function StatusBadge({ status }) {
  const cls = STATUS_CLASS_MAP[status] || "badge-planned";
  return <span className={`badge ${cls}`}>{status}</span>;
}
