import { useOutletContext } from "react-router-dom";

export default function DashboardPage() {
  const { shipments, orders } = useOutletContext();
  const planned = shipments.filter((s) => s.status === "Planned").length;
  const tendered = shipments.filter((s) => s.status === "Tendered").length;
  const delivered = shipments.filter((s) => s.status === "Delivered").length;
  const unplanned = orders.filter((o) => o.status === "Unplanned").length;

  return (
    <div>
      <h2>Dashboard</h2>
      <div className="stats-grid">
        <div className="card">Planned: {planned}</div>
        <div className="card">Tendered: {tendered}</div>
        <div className="card">Delivered: {delivered}</div>
        <div className="card">Unplanned Orders: {unplanned}</div>
      </div>
    </div>
  );
}
