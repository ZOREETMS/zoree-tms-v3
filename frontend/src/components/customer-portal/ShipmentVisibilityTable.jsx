import StatusBadge from "./StatusBadge";
import { SelectionHeaderCheckbox, SelectionRowCheckbox } from "../ui/SelectionCheckbox";

/** Shipment visibility table for customer portal */
// QA 249/254 (2026-05-12): `canEdit` defaults to true and gates the
// per-row Share button so view-only roles cannot send tracking links.
export default function ShipmentVisibilityTable({ rows, onShare, sel, canEdit = true }) {
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
              {sel && (
                <th style={{ width: 36, textAlign: "center" }}>
                  <SelectionHeaderCheckbox sel={sel} rows={rows} />
                </th>
              )}
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
                {sel && (
                  <td style={{ textAlign: "center" }}>
                    <SelectionRowCheckbox sel={sel} rowKey={row.id} />
                  </td>
                )}
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
                  {canEdit && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => onShare(row.id, row.customer)}
                    >
                      📤 Share
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
