import { fmt$ } from "../../utils/orderUtils.jsx";
import { buildSchedulerMetrics } from "../../services/schedulerMetricsService";

function fmtMoney(n) {
  if (!n) return "$0";
  if (n >= 1000) return `$${Math.round(n / 1000)}K`;
  return fmt$(n);
}

function MetricTile({ label, value, sub, tone }) {
  return (
    <div className={`scheduler-metric ${tone ? `tone-${tone}` : ""}`}>
      <div className="scheduler-metric-label">{label}</div>
      <div className="scheduler-metric-value">{value}</div>
      {sub ? <div className="scheduler-metric-sub">{sub}</div> : null}
    </div>
  );
}

export default function SchedulerMetrics({
  orders = [],
  shipments = [],
  schedCountdown = "--:--",
  schedRuns = 0,
  schedPlanned = 0,
  schedSaved = 0,
  schedRunning = false,
}) {
  const m = buildSchedulerMetrics({ orders, shipments, schedRuns, schedSaved, schedRunning });

  return (
    <div className="scheduler-metrics">
      <MetricTile
        label="Next Run In"
        value={<span className="mono">{schedCountdown}</span>}
        sub={`${schedRuns} runs total`}
      />
      <MetricTile
        label="Orders Planned"
        value={schedPlanned}
        sub={`${m.consolidatedToday} consolidated today`}
        tone="good"
      />
      <MetricTile
        label="Avg Savings / Run"
        value={fmtMoney(m.avgSavings)}
        sub={`Total ${fmtMoney(schedSaved)}`}
        tone="good"
      />
      <MetricTile
        label="Avg Utilization"
        value={`${m.avgUtilization}%`}
        sub={m.avgUtilization >= 75 ? "Healthy load factor" : m.avgUtilization >= 50 ? "Room to consolidate" : "Low — review lanes"}
        tone={m.avgUtilization >= 75 ? "good" : m.avgUtilization >= 50 ? "info" : "warn"}
      />
      <MetricTile
        label="Best Lane Today"
        value={m.bestLane ? `${m.bestLane.origin} → ${m.bestLane.dest}` : "—"}
        sub={m.bestLane ? `${m.bestLane.count} orders consolidated` : "No consolidations yet"}
      />
      <MetricTile
        label={<span><span className="ai-badge">AI</span> Recommendation</span>}
        value={m.recommendation.label}
        sub={m.recommendation.reason}
        tone={m.recommendation.tone}
      />
    </div>
  );
}
