import StatCard from "../fleet/StatCard";

export default function BidsStatGrid({ stats }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
      <StatCard label="Active RFQs" value={stats.activeRfqs} color="blue" />
      <StatCard label="Bids Received" value={stats.totalBids} color="yellow" />
      <StatCard label="Awarded" value={stats.awarded} color="green" />
      <StatCard label="Avg Savings" value={stats.avgSavings} color="blue" />
    </div>
  );
}
