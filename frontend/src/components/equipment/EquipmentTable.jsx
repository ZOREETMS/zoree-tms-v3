export default function EquipmentTable({ rows, sortCol, sortAsc, onToggleSort, onEdit, onDelete, busyId }) {
  const SortIcon = ({ col }) => (
    <span style={{ opacity: sortCol === col ? 1 : 0.3, marginLeft: 4 }}>
      {sortCol === col ? (sortAsc ? "▲" : "▼") : "⇅"}
    </span>
  );

  const sortTh = (col, label, style = {}) => (
    <th onClick={() => onToggleSort(col)} style={{ cursor: "pointer", ...style }}>
      {label} <SortIcon col={col} />
    </th>
  );

  return (
    <>
      <table className="grid">
        <thead>
          <tr>
            {sortTh("name", "Name")}
            {sortTh("code", "Code")}
            {sortTh("max_weight", "Max Weight (lbs)", { textAlign: "right" })}
            {sortTh("max_volume", "Max Volume (cu ft)", { textAlign: "right" })}
            <th>Dimensions (L x W x H ft)</th>
            <th style={{ textAlign: "center" }}>Temp Ctrl</th>
            <th style={{ textAlign: "center" }}>Hazmat</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={9} className="empty-state">No equipment types found</td></tr>
          ) : rows.map((eq) => (
            <tr key={eq.id}>
              <td className="fw-700">{eq.name}</td>
              <td><span className="badge badge-blue" style={{ fontSize: 10, fontFamily: "monospace" }}>{eq.code || "—"}</span></td>
              <td className="mono" style={{ textAlign: "right" }}>{Number(eq.max_weight || 0).toLocaleString()}</td>
              <td className="mono" style={{ textAlign: "right" }}>{Number(eq.max_volume || 0).toLocaleString()}</td>
              <td className="mono">{eq.length || "—"} x {eq.width || "—"} x {eq.height || "—"}</td>
              <td style={{ textAlign: "center" }}>{eq.temp_controlled ? "✅" : "☐"}</td>
              <td style={{ textAlign: "center" }}>{eq.hazmat_certified ? "✅" : "☐"}</td>
              <td><span className={`badge ${eq.status === "Active" ? "badge-green" : "badge-red"}`}>{eq.status}</span></td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button className="btn btn-sm" onClick={() => onEdit(eq)}>✏️ Edit</button>{" "}
                <button className="btn btn-sm btn-red" onClick={() => onDelete(eq)} disabled={busyId === eq.id}>🗑️</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-sm text-muted mt-2">{rows.length} equipment types</div>
    </>
  );
}
