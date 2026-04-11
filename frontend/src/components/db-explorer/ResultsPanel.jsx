import { formatCell as formatValue } from "../../utils/formatters";

export default function ResultsPanel({ results, error, isRunning }) {
  if (isRunning) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <ResultsHeader meta="Running…" time="" />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <ResultsHeader meta="Error" time="" />
        <div style={{ flex: 1, padding: 20 }}>
          <div style={{
            padding: 16, background: "#fef2f2", border: "1px solid #fecaca",
            borderRadius: 8, color: "#dc2626", fontSize: 13, fontFamily: "monospace",
          }}>
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!results) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <ResultsHeader meta="—" time="" />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--text3)", fontSize: 13 }}>
          <span style={{ fontSize: 32, opacity: 0.3 }}>⌨</span>
          <span>Write a query and press Run</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <ResultsHeader
        meta={`${results.rowCount} row${results.rowCount !== 1 ? "s" : ""} · ${results.columns.length} col${results.columns.length !== 1 ? "s" : ""}`}
        time={`${results.duration}ms`}
      />
      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              {results.columns.map((col) => (
                <th
                  key={col}
                  style={{
                    position: "sticky", top: 0, padding: "6px 12px",
                    background: "var(--surface)", borderBottom: "2px solid var(--border)",
                    textAlign: "left", fontSize: 11, fontWeight: 700,
                    color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".5px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.rows.map((row, idx) => (
              <tr key={idx} style={{ borderBottom: "1px solid var(--border)" }}>
                {results.columns.map((col) => (
                  <td
                    key={col}
                    style={{
                      padding: "5px 12px", fontFamily: "monospace", fontSize: 12,
                      color: "var(--text1)", whiteSpace: "nowrap", maxWidth: 300,
                      overflow: "hidden", textOverflow: "ellipsis",
                    }}
                    title={String(row[col] ?? "")}
                  >
                    {formatCell(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResultsHeader({ meta, time }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "6px 12px",
      background: "var(--surface)", borderBottom: "1px solid var(--border)", flexShrink: 0,
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".8px", textTransform: "uppercase", color: "var(--text3)" }}>
        Results
      </span>
      <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text2)" }}>{meta}</span>
      {time && (
        <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text3)", marginLeft: "auto" }}>
          {time}
        </span>
      )}
    </div>
  );
}

function formatCell(value) {
  if (value === null || value === undefined) return <span style={{ color: "#94a3b8" }}>null</span>;
  const formatted = formatValue(value);
  return formatted === null ? <span style={{ color: "#94a3b8" }}>null</span> : formatted;
}
