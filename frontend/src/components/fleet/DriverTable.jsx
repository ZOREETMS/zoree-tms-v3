import { useState, useMemo } from "react";
import StatusBadge from "./StatusBadge";
import { HOS_MAX_HOURS } from "../../types/fleet";
import { SelectionHeaderCheckbox, SelectionRowCheckbox } from "../ui/SelectionCheckbox";

const CDL_CLASS_COLORS = { "Class A": "#1d4ed8", "Class B": "#0891b2", "Class C": "#6b7280" };

function HosBar({ hours }) {
  if (!hours || hours <= 0) {
    return <span style={{ fontSize: 11, color: "var(--text3)" }}>{"\u2014"}</span>;
  }
  const pct = Math.min(100, Math.round((hours / HOS_MAX_HOURS) * 100));
  const color = hours >= HOS_MAX_HOURS ? "var(--red)" : hours >= HOS_MAX_HOURS - 2 ? "var(--yellow)" : "var(--green)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 5, background: "#f0f4ff", borderRadius: 3 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3 }} />
      </div>
      <span className="mono" style={{ fontSize: 11, color, fontWeight: 700, whiteSpace: "nowrap" }}>
        {hours}h
      </span>
    </div>
  );
}

function EndorsementBadges({ endorsements }) {
  if (!endorsements?.length) return null;
  return (
    <>
      {endorsements.map((e) => (
        <span
          key={e}
          style={{
            fontSize: 9, fontWeight: 700,
            background: "rgba(59,130,246,.1)", color: "var(--accent)",
            border: "1px solid rgba(59,130,246,.2)",
            padding: "1px 5px", borderRadius: 4, marginLeft: 3,
          }}
        >
          {e}
        </span>
      ))}
    </>
  );
}

export default function DriverTable({ drivers, onEdit, onAssign, onSwitchToVehicles, sel }) {
  const [sortCol, setSortCol] = useState("name");
  const [sortAsc, setSortAsc] = useState(true);

  const in90Str = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 90);
    return d.toISOString().slice(0, 10);
  }, []);

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  }

  const sorted = [...drivers].sort((a, b) => {
    const av = String(a[sortCol] || "").toLowerCase();
    const bv = String(b[sortCol] || "").toLowerCase();
    return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  const thClass = (col) =>
    `sortable ${sortCol === col ? (sortAsc ? "sort-asc" : "sort-desc") : ""}`;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Driver Roster</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {sel && (
                <th style={{ width: 36, textAlign: "center" }}>
                  <SelectionHeaderCheckbox sel={sel} rows={sorted} />
                </th>
              )}
              {[
                { key: "name", label: "Driver" },
                { key: "cdl", label: "CDL #" },
                { key: "cdlClass", label: "Class" },
                { key: "phone", label: "Phone" },
                { key: "vehicle", label: "Assigned Unit" },
                { key: "location", label: "Location" },
                { key: "hosToday", label: "HOS Today" },
                { key: "cdlExp", label: "CDL Expires" },
                { key: "status", label: "Status" },
              ].map((col) => (
                <th key={col.key} className={thClass(col.key)} onClick={() => toggleSort(col.key)}>
                  {col.label}
                </th>
              ))}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={sel ? 11 : 10} style={{ textAlign: "center", color: "var(--text3)", padding: 20 }}>
                  No drivers match current filters
                </td>
              </tr>
            )}
            {sorted.map((d) => {
              const cdlExpiring = d.cdlExp && d.cdlExp <= in90Str;
              return (
                <tr key={d.id}>
                  {sel && (
                    <td style={{ textAlign: "center" }}>
                      <SelectionRowCheckbox sel={sel} rowKey={d.id} />
                    </td>
                  )}
                  <td>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{d.name}</div>
                    {d.notes && (
                      <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2, fontStyle: "italic" }}>
                        {d.notes}
                      </div>
                    )}
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>{d.cdl}</td>
                  <td>
                    <span
                      style={{
                        fontSize: 11, fontWeight: 700,
                        background: "rgba(29,78,216,.1)",
                        color: CDL_CLASS_COLORS[d.cdlClass] || "#6b7280",
                        padding: "2px 7px", borderRadius: 6,
                      }}
                    >
                      {d.cdlClass}
                    </span>
                    <EndorsementBadges endorsements={d.endorsements} />
                  </td>
                  <td style={{ fontSize: 12 }}>{d.phone}</td>
                  <td>
                    {d.vehicle ? (
                      <span
                        className="mono"
                        style={{ color: "var(--accent)", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}
                        onClick={onSwitchToVehicles}
                      >
                        {d.vehicle}
                      </span>
                    ) : (
                      <span style={{ color: "var(--text3)", fontSize: 11 }}>Unassigned</span>
                    )}
                  </td>
                  <td style={{ fontSize: 12 }}>{d.location}</td>
                  <td style={{ minWidth: 100 }}>
                    <HosBar hours={d.hosToday} />
                  </td>
                  <td
                    className="mono"
                    style={{
                      color: cdlExpiring ? "var(--red)" : "var(--text2)",
                      fontSize: 12,
                      fontWeight: cdlExpiring ? 700 : 400,
                    }}
                  >
                    {d.cdlExp}
                    {cdlExpiring && " \u26A0\uFE0F"}
                  </td>
                  <td><StatusBadge status={d.status} /></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => onEdit(d.id)}>
                      ✏️
                    </button>{" "}
                    <button className="btn btn-secondary btn-sm" onClick={() => onAssign(d.id)} title="Assign vehicle/shipment">
                      🚛
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
