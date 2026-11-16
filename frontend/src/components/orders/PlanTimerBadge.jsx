// Scheduler timing badge: last Run Now duration, plus the running total
// across runs once there has been more than one.
const badgeStyle = {
  fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 12,
  background: "rgba(29,93,122,.08)", color: "#1d5d7a", border: "1px solid rgba(29,93,122,.2)",
  fontFamily: "'JetBrains Mono',monospace",
};

export default function PlanTimerBadge({ lastMs, totalMs, runs }) {
  if (lastMs === null || lastMs === undefined) return null;
  const secs = (ms) => (ms / 1000).toFixed(1);
  return (
    <span title={`Last run ${secs(lastMs)}s · ${runs} run(s) totalling ${secs(totalMs)}s`} style={badgeStyle}>
      ⏱ {secs(lastMs)}s
      {runs > 1 && <span style={{ opacity: 0.65 }}> · total {secs(totalMs)}s</span>}
    </span>
  );
}
