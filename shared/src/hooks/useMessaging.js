import { useState, useMemo, useCallback } from "react";
import {
  generateMessages,
  filterMessages,
  computeMessagingKpis,
  buildComposePayload,
} from "../services/messagingService";

export function useMessaging(shipments = []) {
  const [messages, setMessages] = useState(() => generateMessages(shipments));
  const [tab, setTab] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [filters, setFilters] = useState({ direction: "", type: "", status: "", search: "" });

  const filtered = useMemo(
    () => filterMessages(messages, { tab, ...filters }),
    [messages, tab, filters]
  );

  const kpis = useMemo(() => computeMessagingKpis(messages), [messages]);

  const selectedMessage = useMemo(
    () => messages.find((m) => m.id === selectedId) || null,
    [messages, selectedId]
  );

  const updateFilter = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const switchTab = useCallback((newTab) => {
    setTab(newTab);
    if (newTab === "outbound") setFilters((prev) => ({ ...prev, direction: "Outbound" }));
    else if (newTab === "inbound") setFilters((prev) => ({ ...prev, direction: "Inbound" }));
    else setFilters((prev) => ({ ...prev, direction: "" }));
  }, []);

  const sendMessage = useCallback((compose) => {
    const newMsg = {
      id: `MSG-${String(messages.length + 1).padStart(4, "0")}`,
      direction: "Outbound",
      type: compose.type,
      status: "Sent",
      ts: new Date().toISOString(),
      ref: compose.ref,
      dest: compose.dest,
      priority: compose.priority,
      notes: compose.notes,
      payload: compose.payload,
    };
    setMessages((prev) => [newMsg, ...prev]);

    // Simulate delivery
    setTimeout(() => {
      setMessages((prev) =>
        prev.map((m) => (m.id === newMsg.id ? { ...m, status: "Delivered" } : m))
      );
    }, 800);

    return newMsg;
  }, [messages.length]);

  const retryMessage = useCallback((msgId) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, status: "Sent" } : m))
    );
    setTimeout(() => {
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, status: "Delivered" } : m))
      );
    }, 800);
  }, []);

  return {
    messages: filtered,
    allMessages: messages,
    kpis,
    tab,
    switchTab,
    filters,
    updateFilter,
    selectedId,
    setSelectedId,
    selectedMessage,
    sendMessage,
    retryMessage,
  };
}
