import { useState } from "react";

export default function JsonViewer({ message, onRetry }) {
  const [copied, setCopied] = useState(false);

  if (!message) {
    return (
      <div style={{
        background: "#1e1e2e", border: "1.5px solid #313244", borderRadius: 14,
        overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 400,
      }}>
        <div style={{ padding: "12px 18px", background: "#181825", borderBottom: "1px solid #313244" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#a6adc8", textTransform: "uppercase", letterSpacing: ".8px" }}>
            JSON Payload
          </span>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#585b70", padding: 40 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📨</div>
            <div>Select a message to view its JSON payload</div>
          </div>
        </div>
      </div>
    );
  }

  function handleCopy() {
    navigator.clipboard.writeText(JSON.stringify(message.payload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={{
      background: "#1e1e2e", border: "1.5px solid #313244", borderRadius: 14,
      overflow: "hidden", display: "flex", flexDirection: "column",
    }}>
      <div style={{
        padding: "12px 18px", background: "#181825", borderBottom: "1px solid #313244",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#a6adc8", textTransform: "uppercase", letterSpacing: ".8px" }}>
            JSON Payload
          </span>
          <span style={{ fontSize: 10, background: "#313244", color: "#a6adc8", padding: "2px 8px", borderRadius: 10 }}>
            {message.id}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={handleCopy}
            style={{ padding: "4px 12px", background: "#313244", border: "none", color: "#cdd6f4", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
          >
            {copied ? "✅ Copied" : "📋 Copy"}
          </button>
          {message.status === "Failed" && (
            <button
              onClick={() => onRetry(message.id)}
              style={{ padding: "4px 12px", background: "#f38ba8", border: "none", color: "#1e1e2e", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer" }}
            >
              🔄 Retry
            </button>
          )}
        </div>
      </div>
      <div style={{
        flex: 1, overflowY: "auto", padding: 20,
        fontFamily: "monospace", fontSize: 12.5, lineHeight: 1.7, color: "#cdd6f4",
      }}>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {JSON.stringify(message.payload, null, 2)}
        </pre>
      </div>
    </div>
  );
}
