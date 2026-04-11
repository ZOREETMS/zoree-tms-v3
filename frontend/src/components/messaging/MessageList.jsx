import { getTypeLabel, getStatusColor } from "../../services/messagingService";

export default function MessageList({ messages, selectedId, onSelect }) {
  if (messages.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>📨</div>
        <div>No messages found</div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      {messages.map((msg) => (
        <div
          key={msg.id}
          onClick={() => onSelect(msg.id)}
          style={{
            padding: "10px 16px",
            borderBottom: "1px solid var(--border)",
            cursor: "pointer",
            background: selectedId === msg.id ? "#f0f4ff" : "transparent",
            transition: "background .15s",
          }}
          onMouseOver={(e) => { if (selectedId !== msg.id) e.currentTarget.style.background = "#f8fafc"; }}
          onMouseOut={(e) => { if (selectedId !== msg.id) e.currentTarget.style.background = "transparent"; }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text1)" }}>{msg.id}</span>
              <span style={{
                fontSize: 10,
                padding: "1px 6px",
                borderRadius: 8,
                background: msg.direction === "Outbound" ? "#eff6ff" : "#f0fdf4",
                color: msg.direction === "Outbound" ? "#3b82f6" : "#16a34a",
                fontWeight: 600,
              }}>
                {msg.direction === "Outbound" ? "📤" : "📥"} {msg.direction}
              </span>
            </div>
            <span style={{
              fontSize: 10,
              fontWeight: 700,
              color: getStatusColor(msg.status),
            }}>
              {msg.status}
            </span>
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text1)", marginBottom: 2 }}>
            {getTypeLabel(msg.type)}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, color: "var(--text3)" }}>
              {msg.dest} · {msg.ref}
            </span>
            <span style={{ fontSize: 10, color: "var(--text3)" }}>
              {new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
