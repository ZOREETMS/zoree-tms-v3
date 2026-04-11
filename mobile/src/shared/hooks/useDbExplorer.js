import { useState, useCallback } from "react";
import { executeQuery, exportToCSV, downloadCSV } from "../services/dbExplorerService";

export function useDbExplorer(data) {
  const [sql, setSql] = useState("");
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [isRunning, setIsRunning] = useState(false);

  const runQuery = useCallback((queryOverride) => {
    const query = queryOverride || sql;
    if (!query.trim()) return;

    setIsRunning(true);
    setError(null);

    try {
      const result = executeQuery(query, data);
      setResults(result);
    } catch (err) {
      setError(err.message);
      setResults(null);
    } finally {
      setIsRunning(false);
    }
  }, [sql, data]);

  const setQuery = useCallback((newSql) => {
    setSql(newSql);
  }, []);

  const exportCSV = useCallback(() => {
    if (!results) return;
    const csv = exportToCSV(results.columns, results.rows);
    downloadCSV(csv);
  }, [results]);

  const clearResults = useCallback(() => {
    setResults(null);
    setError(null);
    setSql("");
  }, []);

  return {
    sql,
    setSql: setQuery,
    results,
    error,
    isRunning,
    runQuery,
    exportCSV,
    clearResults,
  };
}
