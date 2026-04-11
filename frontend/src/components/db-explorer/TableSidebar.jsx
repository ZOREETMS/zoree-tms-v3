import { DB_TABLES, QUICK_QUERIES } from "../../types/dbexplorer";

export default function TableSidebar({ onSetQuery }) {
  return (
    <div style={{
      width: 200, flexShrink: 0, background: "var(--surface)",
      borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <div style={{ padding: "10px 12px 6px", fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--text3)", borderBottom: "1px solid var(--border)" }}>
        Tables
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {DB_TABLES.map((table) => (
          <div
            key={table}
            onClick={() => onSetQuery(`SELECT * FROM ${table} LIMIT 50`)}
            style={{
              padding: "6px 12px", fontSize: 12, cursor: "pointer",
              color: "var(--text2)", fontFamily: "monospace",
              transition: "background .1s",
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = "#f0f4ff"; }}
            onMouseOut={(e) => { e.currentTarget.style.background = ""; }}
          >
            📁 {table}
          </div>
        ))}
      </div>
      <div style={{ borderTop: "1px solid var(--border)", padding: "4px 0" }}>
        <div style={{ padding: "6px 12px", fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--text3)" }}>
          Quick Queries
        </div>
        {QUICK_QUERIES.map((q) => (
          <div
            key={q.label}
            onClick={() => onSetQuery(q.sql)}
            style={{
              padding: "5px 12px", fontSize: 12, cursor: "pointer",
              color: "var(--accent)", fontWeight: 500,
              transition: "background .1s",
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = "#f0f4ff"; }}
            onMouseOut={(e) => { e.currentTarget.style.background = ""; }}
          >
            ▶ {q.label}
          </div>
        ))}
      </div>
    </div>
  );
}
