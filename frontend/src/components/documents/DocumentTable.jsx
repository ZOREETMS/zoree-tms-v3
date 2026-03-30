import { useState } from "react";
import { DOC_TYPE_COLORS, DOC_STATUS_COLORS } from "../../types/documents";

export default function DocumentTable({ documents, typeFilter, onTypeFilterChange, onView, onSend }) {
  const [sortCol, setSortCol] = useState("generated");
  const [sortAsc, setSortAsc] = useState(false);

  const columns = [
    { key: "id", label: "Doc #" },
    { key: "type", label: "Type" },
    { key: "ship", label: "Shipment" },
    { key: "carrier", label: "Carrier" },
    { key: "generated", label: "Generated" },
    { key: "status", label: "Status" },
  ];

  function handleSort(key) {
    if (sortCol === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(key);
      setSortAsc(true);
    }
  }

  const sorted = [...documents].sort((a, b) => {
    const av = String(a[sortCol] || "").toLowerCase();
    const bv = String(b[sortCol] || "").toLowerCase();
    return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Document Library</span>
        <select
          value={typeFilter}
          onChange={(e) => onTypeFilterChange(e.target.value)}
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
          <option value="">All Types</option>
          <option value="BOL">BOL</option>
          <option value="POD">POD</option>
          <option value="Invoice">Commercial Invoice</option>
          <option value="Hazmat">Hazmat Docs</option>
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  style={{ cursor: "pointer" }}
                >
                  {col.label}
                  {sortCol === col.key && (sortAsc ? " ▲" : " ▼")}
                </th>
              ))}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((doc) => {
              const tc = DOC_TYPE_COLORS[doc.type] || { color: "var(--text)", bg: "#f8faff" };
              const sc = DOC_STATUS_COLORS[doc.status] || { color: "var(--text3)", bg: "#f8faff" };
              return (
                <tr key={doc.id}>
                  <td className="mono" style={{ color: "var(--accent)", fontWeight: 600 }}>{doc.id}</td>
                  <td>
                    <span
                      style={{
                        background: tc.bg,
                        color: tc.color,
                        border: `1px solid ${tc.color}`,
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "2px 9px",
                        borderRadius: 20,
                      }}
                    >
                      {doc.type}
                    </span>
                  </td>
                  <td className="mono">{doc.ship}</td>
                  <td>{doc.carrier}</td>
                  <td className="mono">{doc.generated}</td>
                  <td>
                    <span
                      style={{
                        background: sc.bg,
                        color: sc.color,
                        border: `1px solid ${sc.color}`,
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "2px 9px",
                        borderRadius: 20,
                      }}
                    >
                      {doc.status}
                    </span>
                  </td>
                  <td style={{ display: "flex", gap: 5 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => onView(doc.id)}>
                      View
                    </button>
                    {doc.status === "Pending" && (
                      <button className="btn btn-primary btn-sm" onClick={() => onSend(doc)}>
                        Send
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: 24, color: "var(--text3)" }}>
                  No documents found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
