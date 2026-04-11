import { useState } from "react";
import StatusBadge from "./StatusBadge";

export default function VehicleTable({ vehicles, onEdit, onAssignDriver, onTrack }) {
  const [sortCol, setSortCol] = useState("unit");
  const [sortAsc, setSortAsc] = useState(true);

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  }

  const sorted = [...vehicles].sort((a, b) => {
    const av = String(a[sortCol] || "").toLowerCase();
    const bv = String(b[sortCol] || "").toLowerCase();
    return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  const sortIcon = (col) => {
    if (sortCol !== col) return " \u21C5";
    return sortAsc ? " \u2191" : " \u2193";
  };

  const thClass = (col) =>
    `sortable ${sortCol === col ? (sortAsc ? "sort-asc" : "sort-desc") : ""}`;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Fleet Assets</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {[
                { key: "unit", label: "Unit #" },
                { key: "type", label: "Type" },
                { key: "driver", label: "Driver" },
                { key: "location", label: "Current Location" },
                { key: "dest", label: "Destination" },
                { key: "nextPM", label: "Next PM" },
                { key: "milesYTD", label: "Miles YTD" },
                { key: "status", label: "Status" },
              ].map((col) => (
                <th key={col.key} className={thClass(col.key)} onClick={() => toggleSort(col.key)}>
                  {col.label}
                  <span style={{ fontSize: 10, opacity: sortCol === col.key ? 1 : 0.35, marginLeft: 2 }}>
                    {sortIcon(col.key)}
                  </span>
                </th>
              ))}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", color: "var(--text3)", padding: 20 }}>
                  No vehicles found
                </td>
              </tr>
            )}
            {sorted.map((v) => (
              <tr key={v.unit}>
                <td>
                  <span className="mono" style={{ color: "var(--accent)", fontWeight: 700 }}>
                    {v.unit}
                  </span>
                </td>
                <td><span className="tag">{v.type}</span></td>
                <td>{v.driver}</td>
                <td>{v.location}</td>
                <td style={{ color: "var(--text3)" }}>{v.dest}</td>
                <td className="mono">{v.nextPM}</td>
                <td className="mono">{(v.milesYTD || 0).toLocaleString()} mi</td>
                <td><StatusBadge status={v.status} /></td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => onEdit(v.unit)}>
                    ✏️
                  </button>{" "}
                  <button className="btn btn-secondary btn-sm" onClick={() => onAssignDriver(null)} title="Assign driver">
                    👤
                  </button>
                  {v.status === "In Transit" && (
                    <>
                      {" "}
                      <button className="btn btn-secondary btn-sm" onClick={() => onTrack(v.unit)}>
                        Track
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
