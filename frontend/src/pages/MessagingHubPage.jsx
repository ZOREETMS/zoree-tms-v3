import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useMessaging } from "../hooks/useMessaging";
import { MESSAGE_TYPES, STATUSES } from "../types/messaging";
import MessagingStats from "../components/messaging/MessagingStats";
import MessageList from "../components/messaging/MessageList";
import JsonViewer from "../components/messaging/JsonViewer";
import ComposeMessageModal from "../components/messaging/ComposeMessageModal";
// QA 250/256 (2026-05-12): Planner / Viewer have view-only access to
// Messaging Hub but Compose / Send were unconditional. Gate via
// useFeatureAccess.
import { useFeatureAccess } from "../hooks/useFeatureAccess";

export default function MessagingHubPage() {
  const { shipments } = useOutletContext();
  const { canEdit: canEditMessaging } = useFeatureAccess("messaging");
  const {
    messages, kpis, tab, switchTab, filters, updateFilter,
    selectedId, setSelectedId, selectedMessage, sendMessage, retryMessage,
  } = useMessaging(shipments);

  const [composeOpen, setComposeOpen] = useState(false);
  const [toast, setToast] = useState(null);

  function handleSend(compose) {
    if (!canEditMessaging) {
      setToast({ message: "You have view-only access to Messaging Hub", type: "warning" });
      setTimeout(() => setToast(null), 4000);
      return;
    }
    sendMessage(compose);
    setToast({ message: `Message sent to ${compose.dest}`, type: "success" });
    setTimeout(() => setToast(null), 4000);
  }

  function handleRetry(id) {
    if (!canEditMessaging) {
      setToast({ message: "You have view-only access to Messaging Hub", type: "warning" });
      setTimeout(() => setToast(null), 4000);
      return;
    }
    retryMessage(id);
    setToast({ message: "Message retry initiated", type: "info" });
    setTimeout(() => setToast(null), 4000);
  }

  const tabs = [
    { key: "all", label: "All Messages" },
    { key: "outbound", label: "📤 Outbound" },
    { key: "inbound", label: "📥 Inbound" },
    { key: "failed", label: "⚠️ Failed" },
  ];

  const selectStyle = {
    padding: "7px 12px", border: "1.5px solid var(--border)", borderRadius: 8,
    fontSize: 13, fontFamily: "inherit", background: "#fff",
  };

  return (
    <div>
      <div className="page-header" style={{ flexDirection: "column", alignItems: "stretch", gap: 10, padding: "16px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div className="page-title">📨 Messaging Hub</div>
            <div className="page-sub">Inbound & Outbound TMS messages · Tender offers · WMS sync · Event notifications · All in JSON</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="text"
              placeholder="🔍 Search messages…"
              value={filters.search}
              onChange={(e) => updateFilter("search", e.target.value)}
              style={{ ...selectStyle, width: 200 }}
            />
            <select value={filters.direction} onChange={(e) => updateFilter("direction", e.target.value)} style={selectStyle}>
              <option value="">All Directions</option>
              <option value="Outbound">📤 Outbound</option>
              <option value="Inbound">📥 Inbound</option>
            </select>
            <select value={filters.type} onChange={(e) => updateFilter("type", e.target.value)} style={selectStyle}>
              <option value="">All Types</option>
              {Object.entries(MESSAGE_TYPES).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <select value={filters.status} onChange={(e) => updateFilter("status", e.target.value)} style={selectStyle}>
              <option value="">All Statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {canEditMessaging && (
              <button className="btn btn-primary btn-sm" onClick={() => setComposeOpen(true)}>
                ✉️ Compose Message
              </button>
            )}
          </div>
        </div>

        {/* Tab switcher */}
        <div style={{ display: "flex", gap: 4, background: "#f0f4ff", padding: 4, borderRadius: 10, width: "fit-content" }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              style={{
                padding: "6px 16px", border: "none", borderRadius: 7,
                fontSize: 12, fontWeight: tab === t.key ? 700 : 600, cursor: "pointer",
                fontFamily: "inherit",
                background: tab === t.key ? "var(--accent)" : "transparent",
                color: tab === t.key ? "#fff" : "var(--text2)",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="page-content">
        <MessagingStats kpis={kpis} />

        {/* Two-panel layout */}
        <div style={{ display: "grid", gridTemplateColumns: "420px 1fr", gap: 16, height: "calc(100vh - 340px)", minHeight: 500 }}>
          {/* Left: message list */}
          <div style={{ background: "#fff", border: "1.5px solid var(--border)", borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "12px 16px", background: "#f8faff", borderBottom: "1px solid var(--border)", fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".8px" }}>
              Messages <span style={{ fontWeight: 400, color: "var(--text3)" }}>({messages.length})</span>
            </div>
            <MessageList messages={messages} selectedId={selectedId} onSelect={setSelectedId} />
          </div>

          {/* Right: JSON viewer */}
          <JsonViewer message={selectedMessage} onRetry={handleRetry} />
        </div>
      </div>

      <ComposeMessageModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onSend={handleSend}
        shipments={shipments}
      />

      {toast && (
        <div className="toast-wrap">
          <div className="toast">
            <span style={{ fontSize: 16 }}>{toast.type === "success" ? "✅" : "ℹ️"}</span>
            <span style={{ fontSize: 13 }}>{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}
