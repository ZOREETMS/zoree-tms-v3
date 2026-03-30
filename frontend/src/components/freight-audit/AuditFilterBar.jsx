export default function AuditFilterBar({ filter, onFilterChange }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <select
        value={filter}
        onChange={(e) => onFilterChange(e.target.value)}
        style={{
          fontSize: 12,
          padding: "4px 8px",
          borderRadius: 6,
          border: "1px solid var(--border)",
          background: "#f8faff",
          fontFamily: "inherit",
          textTransform: "uppercase",
        }}
      >
        <option value="">All</option>
        <option value="Discrepancy">Discrepancies</option>
        <option value="Matched">Matched</option>
        <option value="Pending">Pending</option>
      </select>
    </div>
  );
}
