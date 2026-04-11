import { STATUS_BADGES } from "../../types/invoice";

function Badge({ status }) {
  const style = STATUS_BADGES[status] || STATUS_BADGES.Pending;
  return (
    <span
      className="badge"
      style={{
        background: style.bg,
        color: style.color,
        border: `1px solid ${style.border}`,
      }}
    >
      <span
        style={{
          width: 5, height: 5, borderRadius: "50%",
          background: style.dot, display: "inline-block",
          marginRight: 4,
        }}
      />
      {status}
    </span>
  );
}

function VarianceCell({ variance }) {
  if (variance === 0) return <td className="mono" style={{ color: "var(--text3)" }}>—</td>;
  const color = variance > 0 ? "var(--red)" : "var(--green)";
  const sign = variance > 0 ? "+" : "";
  return (
    <td className="mono" style={{ color }}>
      {sign} ${Math.abs(variance).toLocaleString()}
    </td>
  );
}

function SortHeader({ label, col, sortCol, sortAsc, onSort }) {
  const active = sortCol === col;
  const arrow = active ? (sortAsc ? " ↑" : " ↓") : " ⇅";
  return (
    <th
      className={`sortable ${active ? (sortAsc ? "sort-asc" : "sort-desc") : ""}`}
      onClick={() => onSort(col)}
      style={{ cursor: "pointer" }}
    >
      {label}
      <span style={{ fontSize: 10, marginLeft: 2, opacity: active ? 1 : 0.35 }}>
        {arrow}
      </span>
    </th>
  );
}

export default function InvoiceTable({
  invoices, sortCol, sortAsc, onSort,
  onApprove, onDispute,
}) {
  const columns = [
    { label: "Invoice #", col: "num" },
    { label: "Carrier", col: "carrier" },
    { label: "Shipment", col: "shipId" },
    { label: "Date", col: "date" },
    { label: "Due", col: "due" },
    { label: "Agreed", col: "agreed" },
    { label: "Invoiced", col: "amount" },
    { label: "Variance", col: "variance" },
    { label: "Status", col: "status" },
  ];

  return (
    <div className="card">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <SortHeader
                  key={c.col}
                  label={c.label}
                  col={c.col}
                  sortCol={sortCol}
                  sortAsc={sortAsc}
                  onSort={onSort}
                />
              ))}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 && (
              <tr>
                <td colSpan={10} style={{ textAlign: "center", padding: 40, color: "var(--text3)" }}>
                  No invoices found
                </td>
              </tr>
            )}
            {invoices.map((inv) => (
              <tr key={inv.num}>
                <td>
                  <span className="mono" style={{ color: "var(--accent)" }}>
                    {inv.num}
                  </span>
                </td>
                <td>{inv.carrier}</td>
                <td className="mono">{inv.shipId}</td>
                <td className="mono">{inv.date}</td>
                <td className="mono">{inv.due}</td>
                <td className="mono">${(inv.agreed || 0).toLocaleString()}</td>
                <td className="mono">${(inv.amount || 0).toLocaleString()}</td>
                <VarianceCell variance={inv.variance} />
                <td><Badge status={inv.status} /></td>
                <td>
                  {inv.status === "Pending" && (
                    <button
                      className="btn btn-success btn-sm"
                      onClick={() => onApprove(inv.num)}
                    >
                      Approve
                    </button>
                  )}
                  {inv.status === "Disputed" && (
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => onDispute(inv.num)}
                    >
                      Dispute
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
