import { useOutletContext } from "react-router-dom";
import { useDbExplorer } from "../hooks/useDbExplorer";
import TableSidebar from "../components/db-explorer/TableSidebar";
import SqlEditor from "../components/db-explorer/SqlEditor";
import ResultsPanel from "../components/db-explorer/ResultsPanel";

export default function DbExplorerPage() {
  const data = useOutletContext();
  const { sql, setSql, results, error, isRunning, runQuery, exportCSV, clearResults } = useDbExplorer(data);

  function handleRunQueryFromSidebar(querySql) {
    setSql(querySql);
    runQuery(querySql);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Toolbar */}
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: "var(--text1)", margin: 0 }}>🗄️ DB Explorer</h2>
          <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>
            Query your Supabase database directly · <span style={{ color: "#22c55e" }}>● Connected</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {results && (
            <button className="btn btn-secondary btn-sm" onClick={exportCSV}>
              ↓ Export CSV
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => runQuery()}>
            ▶ Run <span style={{ opacity: 0.6, fontSize: 11 }}>Ctrl+Enter</span>
          </button>
        </div>
      </div>

      {/* Body: sidebar + editor/results */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <TableSidebar onSetQuery={handleRunQueryFromSidebar} />

        {/* Right panel */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
          <SqlEditor sql={sql} onChange={setSql} onRun={() => runQuery()} onClear={clearResults} />
          <ResultsPanel results={results} error={error} isRunning={isRunning} />
        </div>
      </div>
    </div>
  );
}
