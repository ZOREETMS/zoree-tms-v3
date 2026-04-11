function formatCurrency(val) {
  if (val >= 1000) return "$" + Math.round(val / 1000) + "K";
  return "$" + val.toLocaleString();
}

export default function AnalyticsStats({ kpis }) {
  const { totalShipments, onTimePct, totalSpend, costPerShipment } = kpis;

  return (
    <div className="stat-grid" style={{ marginBottom: 20 }}>
      <div className="stat-card blue">
        <div className="stat-label">Total Shipments (30d)</div>
        <div className="stat-value">{totalShipments}</div>
        <div className="stat-delta">
          <span className="up">↑ 12%</span> vs prior
        </div>
      </div>

      <div className="stat-card green">
        <div className="stat-label">On-Time Delivery</div>
        <div className="stat-value">{onTimePct}%</div>
        <div className="stat-delta">Target: 95%</div>
      </div>

      <div className="stat-card yellow">
        <div className="stat-label">Total Freight Spend</div>
        <div className="stat-value">{formatCurrency(totalSpend)}</div>
        <div className="stat-delta">
          <span className="down">↑ 4%</span> vs budget
        </div>
      </div>

      <div className="stat-card red">
        <div className="stat-label">Cost per Shipment</div>
        <div className="stat-value">
          ${costPerShipment.toLocaleString()}
        </div>
        <div className="stat-delta">
          <span className="down">↑ $42</span> vs target
        </div>
      </div>
    </div>
  );
}
