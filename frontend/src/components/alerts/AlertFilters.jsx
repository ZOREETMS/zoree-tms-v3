import { ALERT_SEVERITY, ALERT_CATEGORY, ALERT_STATUS } from "../../types/alerts";

export default function AlertFilters({
  search,
  onSearchChange,
  severity,
  onSeverityChange,
  category,
  onCategoryChange,
  status,
  onStatusChange,
}) {
  return (
    <div className="search-bar" style={{ marginBottom: 18 }}>
      <input
        type="text"
        className="search-input"
        placeholder="Search alerts..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        style={{ width: 260 }}
      />

      <select className="fsel" value={severity} onChange={(e) => onSeverityChange(e.target.value)}>
        <option value="">All Severities</option>
        {Object.entries(ALERT_SEVERITY).map(([key, val]) => (
          <option key={key} value={val}>{key.charAt(0) + key.slice(1).toLowerCase()}</option>
        ))}
      </select>

      <select className="fsel" value={category} onChange={(e) => onCategoryChange(e.target.value)}>
        <option value="">All Categories</option>
        {Object.values(ALERT_CATEGORY).map((cat) => (
          <option key={cat} value={cat}>{cat}</option>
        ))}
      </select>

      <select className="fsel" value={status} onChange={(e) => onStatusChange(e.target.value)}>
        <option value="">All Statuses</option>
        {Object.values(ALERT_STATUS).map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    </div>
  );
}
