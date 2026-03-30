import { ALERT_SEVERITY, ALERT_CATEGORY, ALERT_STATUS } from "../../types/alerts";

export default function AlertFilterBar({ search, onSearchChange, severity, onSeverityChange, category, onCategoryChange, status, onStatusChange }) {
  const selectStyle = {
    padding: "7px 10px",
    border: "1.5px solid var(--border)",
    borderRadius: 8,
    fontSize: 13,
    fontFamily: "inherit",
    background: "#fff",
  };

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input
        type="text"
        placeholder="🔍 Search alerts…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        style={{ ...selectStyle, width: 200 }}
      />
      <select value={severity} onChange={(e) => onSeverityChange(e.target.value)} style={selectStyle}>
        <option value="">All Severities</option>
        {Object.entries(ALERT_SEVERITY).map(([key, val]) => (
          <option key={key} value={val}>{key.charAt(0) + key.slice(1).toLowerCase()}</option>
        ))}
      </select>
      <select value={category} onChange={(e) => onCategoryChange(e.target.value)} style={selectStyle}>
        <option value="">All Categories</option>
        {Object.values(ALERT_CATEGORY).map((cat) => (
          <option key={cat} value={cat}>{cat}</option>
        ))}
      </select>
      <select value={status} onChange={(e) => onStatusChange(e.target.value)} style={selectStyle}>
        <option value="">All Statuses</option>
        {Object.values(ALERT_STATUS).map((st) => (
          <option key={st} value={st}>{st}</option>
        ))}
      </select>
    </div>
  );
}
