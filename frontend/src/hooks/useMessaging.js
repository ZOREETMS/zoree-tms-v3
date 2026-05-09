// ═══════════════════════════════════════════════════════════════════
// useMessaging — Messaging Hub stateful hook.
//
// Per CLAUDE_RULES §3 server state is separated from UI state:
//   • messages, kpis, selectedMessage  →  loaded from messagingApi
//   • tab, filters, selectedId         →  local UI state
//
// Per CLAUDE_RULES §4 the hook NEVER calls fetch directly — it goes
// through services/messagingApi.js, which is the only network surface
// for the Hub feature.
//
// Public contract (matches the prior synthetic-feed contract so
// MessagingHubPage.jsx and the messaging components don't change):
//   { messages, allMessages, kpis, tab, switchTab, filters, updateFilter,
//     selectedId, setSelectedId, selectedMessage,
//     sendMessage, retryMessage, isLoading, error, refresh }
//
// Note: this hook is the page's data source. If the project later
// adopts React Query the swap is local — components stay the same.
// ═══════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from "react";
import * as messagingApi from "../services/messagingApi";
import { computeMessagingKpis, filterMessages } from "../services/messagingService";

// Polling cadence: a real-time channel can replace this later. 15s
// is enough for the Hub to feel live without hammering the API.
const POLL_INTERVAL_MS = 15_000;

export function useMessaging(/* shipments — kept in signature for caller compat */) {
  const [allMessages, setAllMessages] = useState([]);
  const [kpis, setKpis] = useState({
    total: 0, outbound: 0, inbound: 0, delivered: 0, failed: 0, pending: 0,
  });
  const [tab, setTab] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [filters, setFilters] = useState({ direction: "", type: "", status: "", search: "" });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [msgs, k] = await Promise.all([
        messagingApi.listMessages({ limit: 500 }),
        messagingApi.getKpis(),
      ]);
      setAllMessages(msgs);
      setKpis(k);
    } catch (err) {
      console.error("[useMessaging] refresh failed:", err);
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load + polling.
  useEffect(() => {
    let cancelled = false;
    refresh();
    const t = setInterval(() => { if (!cancelled) refresh(); }, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [refresh]);

  // Re-derive KPIs locally when the message list changes too — keeps
  // the bar in sync between polls (e.g. just after sendMessage).
  const localKpis = useMemo(() => computeMessagingKpis(allMessages), [allMessages]);
  const mergedKpis = useMemo(() => ({
    ...kpis,
    // Prefer the server-side count when it's larger (paging cap on
    // listMessages means the local count can under-report).
    total:     Math.max(kpis.total     || 0, localKpis.total),
    outbound:  Math.max(kpis.outbound  || 0, localKpis.outbound),
    inbound:   Math.max(kpis.inbound   || 0, localKpis.inbound),
    delivered: Math.max(kpis.delivered || 0, localKpis.delivered),
    failed:    Math.max(kpis.failed    || 0, localKpis.failed),
    pending:   Math.max(kpis.pending   || 0, localKpis.pending),
  }), [kpis, localKpis]);

  const filtered = useMemo(
    () => filterMessages(allMessages, { tab, ...filters }),
    [allMessages, tab, filters]
  );

  const selectedMessage = useMemo(
    () => allMessages.find((m) => m.id === selectedId) || null,
    [allMessages, selectedId]
  );

  const updateFilter = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const switchTab = useCallback((newTab) => {
    setTab(newTab);
    if (newTab === "outbound")     setFilters((prev) => ({ ...prev, direction: "Outbound" }));
    else if (newTab === "inbound") setFilters((prev) => ({ ...prev, direction: "Inbound" }));
    else                            setFilters((prev) => ({ ...prev, direction: "" }));
  }, []);

  // Compose-and-send. The service layer persists; we refresh to surface
  // the server-side row (with its real id, ts, etc.).
  const sendMessage = useCallback(async (compose) => {
    try {
      await messagingApi.composeMessage(compose);
      await refresh();
    } catch (err) {
      console.error("[useMessaging] sendMessage failed:", err);
      setError(err);
      throw err;
    }
  }, [refresh]);

  const retryMessage = useCallback(async (msgId) => {
    try {
      await messagingApi.retryMessage(msgId);
      await refresh();
    } catch (err) {
      console.error("[useMessaging] retryMessage failed:", err);
      setError(err);
      throw err;
    }
  }, [refresh]);

  return {
    messages: filtered,
    allMessages,
    kpis: mergedKpis,
    tab,
    switchTab,
    filters,
    updateFilter,
    selectedId,
    setSelectedId,
    selectedMessage,
    sendMessage,
    retryMessage,
    isLoading,
    error,
    refresh,
  };
}
