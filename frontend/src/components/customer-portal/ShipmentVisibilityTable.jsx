import StatusBadge from "./StatusBadge";

/** Shipment visibility table for customer portal */
export default function ShipmentVisibilityTable({ rows, onShare }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="card">
        <div className="card-header">
          <span className="card-title">Customer Shipment Visibility</span>
        </div>
        <div style={{ padding: 40, textAlign: "center", color: "var(--text3)" }}>
          No shipments to display
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Customer Shipment Visibility</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Shipment</th>
              <th>Customer</th>
              <th>Origin → Destination</th>
              <th>Status</th>
              <th>ETA</th>
              <th>Last Update</th>
              <th>Portal View</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <span className="mono" style={{ color: "var(--accent)", cursor: "pointer", textDecoration: "underline" }}>
                    {row.id}
                  </span>
                </td>
                <td>{row.customer}</td>
                <td style={{ fontSize: 12 }}>
                  {row.originShort} → {row.destShort}
                </td>
                <td>
                  <StatusBadge status={row.status} />
                </td>
                <td className="mono">{row.eta}</td>
                <td className="mono" style={{ fontSize: 11, color: "var(--text3)" }}>
                  {row.lastUpdate}
                </td>
                <td>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => onShare(row.id, row.customer)}
                  >
                    📤 Share
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
