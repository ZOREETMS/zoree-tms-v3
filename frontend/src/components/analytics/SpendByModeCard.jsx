function formatAmount(val) {
  if (val >= 1000) return "$" + (val / 1000).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return "$" + val.toLocaleString();
}

export default function SpendByModeCard({ spendByMode }) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Spend by Mode</span>
      </div>
      <div className="card-body">
        {spendByMode.map((mode) => (
          <div key={mode.key} style={{ marginBottom: 12 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 4,
              }}
            >
              <span>{mode.label}</span>
              <span
                className="mono"
                style={{ fontSize: 12, color: "var(--text2)" }}
              >
                {formatAmount(mode.amount)} ({mode.pct}%)
              </span>
            </div>
            <div className="progress-wrap">
              <div
                className="progress-bar"
                style={{
                  width: `${mode.pct}%`,
                  background: mode.color,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
