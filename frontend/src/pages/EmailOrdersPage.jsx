// Email Orders — review queue for the email order agent. Also rendered
// inside the AI Agents console (embedded) as the Email Order Agent tab.
// The agent reads the mailbox, Claude extracts each order, and nothing
// reaches the Orders board until a planner clicks "Create order".
import { useState } from "react";
import IntakeCard from "../components/email-orders/IntakeCard";
import PastePanel from "../components/email-orders/PastePanel";
import CreatedBanner from "../components/email-orders/CreatedBanner";
import { ui } from "../components/email-orders/styles";
import { INTAKE_TABS, describeInboxCheck } from "../services/emailIntakeService";
import { useEmailIntakeStatus, useEmailIntakeList, useRefreshEmailIntake, useCheckInbox } from "../hooks/useEmailIntake";
import { formatAgo } from "../utils/formatters";

export default function EmailOrdersPage({ embedded = false }) {
  const [tab, setTab] = useState("pending_review");
  const [showPaste, setShowPaste] = useState(false);
  const [created, setCreated] = useState([]); // confirmations, newest first

  const statusQuery = useEmailIntakeStatus();
  const listQuery = useEmailIntakeList(tab);
  const refresh = useRefreshEmailIntake();
  const inboxCheck = useCheckInbox();

  const status = statusQuery.data || null;
  const items = listQuery.data || [];
  const loading = listQuery.isLoading;
  const checking = inboxCheck.isPending;
  const error = (statusQuery.error || listQuery.error || inboxCheck.error)?.message || "";
  const notice = describeInboxCheck(inboxCheck.data);
  const checkNow = () => inboxCheck.mutate();

  const counts = (status && status.counts) || {};
  const countsError = status && status.countsError;

  return (
    <div style={embedded ? undefined : ui.wrap}>
      {!embedded && <h2 style={{ margin: 0 }}>Email Orders</h2>}
      {!embedded && <div style={ui.muted}>Order requests read from your inbox by the AI agent. Review each one, fix anything it got wrong, and create the order.</div>}

      {status && (
        <div style={ui.bar}>
          <span style={ui.dot(status.enabled)} />
          <span style={{ fontWeight: 600 }}>
            {status.enabled ? `Watching ${status.mailbox} every ${Math.round(status.intervalSec / 60) || 1} min` : "Mailbox not connected: paste an order email to run the agent"}
          </span>
          <span style={{ opacity: 0.7, fontSize: 13 }}>
            {status.enabled ? `Last check ${formatAgo(status.lastRunAt)}` : ""}{status.autoCreate ? " · auto-create ON for high-confidence complete orders" : `${status.enabled ? " · " : ""}every order needs approval`}
          </span>
          <span style={{ flex: 1 }} />
          <button style={{ ...ui.btn2, opacity: checking || !status.mailboxConfigured ? 0.6 : 1 }} disabled={checking || !status.mailboxConfigured}
            onClick={checkNow} title={status.mailboxConfigured ? "" : "Mailbox not configured on the server"}>
            {checking ? "Checking…" : "Check inbox now"}
          </button>
          <button style={ui.btn2} onClick={() => setShowPaste(!showPaste)}>{showPaste ? "Close" : "Paste an email"}</button>
        </div>
      )}
      {status && status.lastError && <div style={ui.err}>Last check failed: {status.lastError}</div>}
      {status && !status.claudeConfigured && <div style={ui.err}>ANTHROPIC_API_KEY is not set on the server — the agent can't read emails yet.</div>}
      {countsError && <div style={ui.err}>Could not read the email queue: {countsError}</div>}
      {notice && <div style={{ ...ui.muted, margin: "8px 0" }}>{notice}</div>}
      {error && <div style={ui.err}>{error}</div>}

      <CreatedBanner
        items={created}
        onDismiss={(id) => setCreated((p) => p.filter((c) => c.intakeId !== id))}
        onShowCreated={() => setTab("created")}
      />

      {showPaste && <PastePanel onDone={() => { setShowPaste(false); setTab("pending_review"); refresh(); }} />}

      <div style={ui.tabs}>
        {INTAKE_TABS.map((t) => (
          <button key={t.key} style={ui.tab(tab === t.key)} onClick={() => setTab(t.key)}>
            {t.label}{counts[t.key] ? ` (${counts[t.key]})` : ""}
          </button>
        ))}
      </div>

      {loading ? <div style={ui.muted}>Loading…</div> : items.length === 0 ? (
        <div style={{ ...ui.muted, padding: "30px 0", textAlign: "center" }}>
          {tab === "pending_review" ? "Nothing to review. New order emails will show up here." : "Nothing here."}
        </div>
      ) : items.map((it) => (
        <IntakeCard key={`${it.id}:${it.status}`} item={it} onChanged={refresh}
          onCreated={(c) => { setCreated((p) => [c, ...p.filter((x) => x.intakeId !== c.intakeId)].slice(0, 5)); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
      ))}
    </div>
  );
}
