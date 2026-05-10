import { STATUS_BADGES } from "../../types/invoice";
import {
  canManualApprove,
  canManualReject,
  canAutoDecide,
} from "../../services/invoiceActionsService";

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
  // REQ-190 / REQ-191:
  //   onApprove    — manual force-approve (handler receives invoice.num)
  //   onReject     — manual force-reject  (handler receives invoice.num)
  //   onAutoDecide — run carrier-tolerance comparison (handler receives invoice.num)
  // `onDispute` is accepted as a back-compat alias for onReject so older
  // callers (and the QA gate in FreightInvoicesPage) keep working through
  // one release while we migrate.
  onApprove, onReject, onDispute, onAutoDecide, onSendToAp,
  onOpenInvoice,
}) {
  // Resolve the reject handler from either prop name. Prefer the new
  // canonical name when both are provided.
  const rejectHandler = onReject || onDispute;
  // Action-column buttons live inside a row that is itself clickable
  // (to open the invoice detail modal). Stop propagation so an action
  // click doesn't also trigger the row's open handler.
  function actionClick(handler, ...args) {
    return (e) => {
      e.stopPropagation();
      handler?.(...args);
    };
  }

  function rowKeyDown(e, inv) {
    if (!onOpenInvoice) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpenInvoice(inv);
    }
  }
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
              <tr
                key={inv.num}
                onClick={onOpenInvoice ? () => onOpenInvoice(inv) : undefined}
                onKeyDown={(e) => rowKeyDown(e, inv)}
                tabIndex={onOpenInvoice ? 0 : undefined}
                role={onOpenInvoice ? "button" : undefined}
                aria-label={onOpenInvoice ? `Open invoice ${inv.num}` : undefined}
                style={onOpenInvoice ? { cursor: "pointer" } : undefined}
              >
                <td>
                  <span className="mono" style={{ color: "var(--accent)" }}>
                    {inv.num}
                  </span>
                </td>
                <td>{inv.carrier}</td>
                <td className="mono">
                  {Array.isArray(inv.shipIds) && inv.shipIds.length > 1 ? (
                    <span title={inv.shipIds.join(", ")} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <span>{inv.shipId || inv.shipIds[0]}</span>
                      <span style={{ padding: "1px 6px", fontSize: 9, fontWeight: 700, borderRadius: 999, background: "#e0e7ff", color: "#3730a3", border: "1px solid #a5b4fc" }}>
                        +{inv.shipIds.length - 1} (consolidated)
                      </span>
                    </span>
                  ) : (inv.shipId || "—")}
                </td>
                <td className="mono">{inv.date}</td>
                <td className="mono">{inv.due}</td>
                <td className="mono">${(inv.agreed || 0).toLocaleString()}</td>
                <td className="mono">${(inv.amount || 0).toLocaleString()}</td>
                <VarianceCell variance={inv.variance} />
                <td>
                  <Badge status={inv.status} />
                  {inv.sentToApAt && (
                    <span title={`Sent to AP at ${inv.sentToApAt}`}
                      style={{ marginLeft: 6, padding: "1px 6px", fontSize: 9, fontWeight: 700, borderRadius: 999, background: "#dcfce7", color: "#166534", border: "1px solid #86efac" }}>
                      AP ✓
                    </span>
                  )}
                  {inv.decisionReason && (
                    <div title={inv.decisionReason} style={{ fontSize: 10, color: "var(--text3)", marginTop: 2, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {inv.decisionReason}
                    </div>
                  )}
                </td>
                <td style={{ whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                  {/* REQ-190 / REQ-191: row-level actions mirror the
                      modal footer so finance can approve/reject/auto-
                      decide without opening the row. stopPropagation on
                      the cell keeps action clicks from also opening the
                      row's detail modal. Visibility is driven by the
                      same predicates the modal uses so the two surfaces
                      cannot drift. */}
                  {onApprove && canManualApprove(inv.status) && (
                    <button
                      className="btn btn-success btn-sm"
                      onClick={actionClick(onApprove, inv.num)}
                      style={{ marginRight: 4 }}
                      title="Force this invoice to Approved (manual override)."
                    >
                      Approve
                    </button>
                  )}
                  {rejectHandler && canManualReject(inv.status) && (
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={actionClick(rejectHandler, inv.num)}
                      style={{ marginRight: 4 }}
                      title="Force this invoice to Rejected (manual override)."
                    >
                      Reject
                    </button>
                  )}
                  {onAutoDecide && canAutoDecide(inv.status) && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={actionClick(onAutoDecide, inv.num)}
                      style={{ marginRight: 4 }}
                      title="Run the carrier-tolerance check. Within tolerance → Approved & sent to AP. Outside → Rejected."
                    >
                      Auto
                    </button>
                  )}
                  {inv.status === "Approved" && !inv.sentToApAt && onSendToAp && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={actionClick(onSendToAp, inv.num)}
                      style={{ background: "#059669", borderColor: "#059669" }}
                    >
                      Send to AP
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
