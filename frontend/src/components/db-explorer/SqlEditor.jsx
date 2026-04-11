import { useMemo } from "react";

export default function SqlEditor({ sql, onChange, onRun, onClear }) {
  const lineNumbers = useMemo(() => {
    const count = (sql || "").split("\n").length;
    return Array.from({ length: Math.max(count, 1) }, (_, i) => i + 1).join("\n");
  }, [sql]);

  function handleKeyDown(e) {
    if (e.ctrlKey && e.key === "Enter") {
      e.preventDefault();
      onRun();
    }
    // Handle tab for indentation
    if (e.key === "Tab") {
      e.preventDefault();
      const start = e.target.selectionStart;
      const end = e.target.selectionEnd;
      const newVal = sql.substring(0, start) + "  " + sql.substring(end);
      onChange(newVal);
      requestAnimationFrame(() => {
        e.target.selectionStart = e.target.selectionEnd = start + 2;
      });
    }
  }

  return (
    <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".8px", textTransform: "uppercase", color: "var(--text3)" }}>SQL</span>
        <button className="btn btn-secondary btn-sm" onClick={onClear} style={{ padding: "2px 10px", fontSize: 11, marginLeft: "auto" }}>
          Clear
        </button>
      </div>
      <div style={{ display: "flex", height: 160 }}>
        <div style={{
          width: 38, flexShrink: 0, background: "var(--surface)", borderRight: "1px solid var(--border)",
          padding: "10px 8px", fontFamily: "'Courier New', monospace", fontSize: 12, lineHeight: "20px",
          color: "var(--text3)", textAlign: "right", overflow: "hidden", userSelect: "none", whiteSpace: "pre",
        }}>
          {lineNumbers}
        </div>
        <textarea
          value={sql}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          placeholder={"-- SQL query here (Ctrl+Enter to run)\nSELECT * FROM orders LIMIT 10"}
          style={{
            flex: 1, background: "#0d1117", color: "#e6edf3",
            fontFamily: "'Courier New', monospace", fontSize: 12.5, lineHeight: "20px",
            border: "none", outline: "none", resize: "none", padding: "10px 12px",
            caretColor: "#58a6ff", tabSize: 2, overflow: "auto",
          }}
        />
      </div>
    </div>
  );
}
