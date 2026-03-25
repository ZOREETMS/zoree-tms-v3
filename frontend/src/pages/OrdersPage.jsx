import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";

export default function OrdersPage() {
  const { orders } = useOutletContext();
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const t = q.toLowerCase().trim();
    if (!t) return orders;
    return orders.filter((o) =>
      [o.id, o.customer, o.origin, o.dest, o.shipment_id].some((v) =>
        String(v || "").toLowerCase().includes(t)
      )
    );
  }, [orders, q]);

  return (
    <div>
      <h2>Orders</h2>
      <input
        placeholder="Search orders"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="search"
      />
      <table className="grid">
        <thead>
          <tr>
            <th>ID</th>
            <th>Customer</th>
            <th>Origin</th>
            <th>Dest</th>
            <th>Status</th>
            <th>Shipment</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id}>
              <td>{o.id}</td>
              <td>{o.customer}</td>
              <td>{o.origin}</td>
              <td>{o.dest}</td>
              <td>{o.status}</td>
              <td>{o.shipment_id || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
