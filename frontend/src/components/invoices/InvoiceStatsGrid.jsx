function formatCurrency(val) {
  if (val >= 1000) return "$" + (val / 1000).toFixed(val >= 10000 ? 0 : 1) + "K";
  return "$" + val.toLocaleString();
}

export default function InvoiceStatsGrid({ stats }) {
  return (
    <div className="stat-grid">
      <div className="stat-card green">
        <div className="stat-label">Approved</div>
        <div className="stat-value" style={{ fontSize: 22 }}>
          {formatCurrency(stats.approvedTotal)}
        </div>
        <div className="stat-delta">{stats.approvedCount} invoices</div>
      </div>

      <div className="stat-card yellow">
        <div className="stat-label">Pending Review / On Hold</div>
        <div className="stat-value" style={{ fontSize: 22 }}>
          {formatCurrency(stats.pendingTotal)}
        </div>
        <div className="stat-delta">{stats.pendingCount} invoices</div>
      </div>

      <div className="stat-card red">
        <div className="stat-label">Disputed</div>
        <div className="stat-value" style={{ fontSize: 22 }}>
          {formatCurrency(stats.disputedTotal)}
        </div>
        <div className="stat-delta">{stats.disputedCount} invoices</div>
      </div>

      <div className="stat-card blue">
        <div className="stat-label">Overbilled vs contract</div>
        <div className="stat-value" style={{ fontSize: 22 }}>
          {formatCurrency(stats.overbilledAmt ?? stats.auditSavingsAmt)}
        </div>
        <div className="stat-delta">
          {stats.overbilledCount ?? 0} invoice{stats.overbilledCount === 1 ? "" : "s"} · base or fuel above the contract rate
          {stats.extrasAwaitingAmt > 0 && (
            <div style={{ marginTop: 2 }}>+ {formatCurrency(stats.extrasAwaitingAmt)} in extras awaiting approval</div>
          )}
        </div>
      </div>
    </div>
  );
}
