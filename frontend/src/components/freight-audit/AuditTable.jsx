import { computeVariance, formatVariance } from "../../services/freightAuditService";
import { AuditStatusBadge, PayStatusBadge } from "./AuditStatusBadge";
import AuditActionButtons from "./AuditActionButtons";

export default function AuditTable({ records, onApprove, onDispute, onRelease }) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Audit Queue</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Carrier</th>
              <th>Shipment</th>
              <th>Agreed Rate</th>
              <th>Billed Amount</th>
              <th>Variance</th>
              <th>Issue Type</th>
              <th>Audit Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const variance = computeVariance(r.agreed, r.billed);
              const varColor = variance > 0 ? "var(--red)" : variance < 0 ? "var(--green)" : "var(--text3)";
              return (
                <tr key={r.inv}>
                  <td className="mono" style={{ color: "var(--accent)", fontWeight: 600 }}>{r.inv}</td>
                  <td>{r.carrier}</td>
                  <td className="mono">{r.ship}</td>
                  <td className="mono">${r.agreed.toLocaleString()}</td>
                  <td className="mono">${r.billed.toLocaleString()}</td>
                  <td className="mono" style={{ color: varColor, fontWeight: 700 }}>
                    {formatVariance(variance)}
                  </td>
                  <td style={{ fontSize: 12, color: "var(--text3)" }}>{r.issue || "—"}</td>
                  <td>
                    <AuditStatusBadge status={r.auditStatus} />
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                      <AuditActionButtons
                        record={r}
                        onApprove={onApprove}
                        onDispute={onDispute}
                        onRelease={onRelease}
                      />
                      <PayStatusBadge status={r.payStatus} />
                    </div>
                  </td>
                </tr>
              );
            })}
            {records.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", padding: 40, color: "var(--text3)" }}>
                  No audit records match the current filter
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
