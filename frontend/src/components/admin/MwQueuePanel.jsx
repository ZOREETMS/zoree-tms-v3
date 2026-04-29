// ═══════════════════════════════════════════════════════════════════
// MwQueuePanel — admin UI for the backend MW Queue Worker
//
// Single-purpose presentational component. All data + actions come
// from the hook + service layer (CLAUDE_RULES §2, §3). No fetch(),
// no business logic, no inline date math — everything is pre-shaped.
// ═══════════════════════════════════════════════════════════════════

import React, { useState } from "react";
import useMwQueueStatus from "../../hooks/useMwQueueStatus";
import { startWorker, stopWorker, runOnce } from "../../services/mwQueueService";

const PILL = {
  base: {
    display: "inline-block",
    padding: "2px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  running: { background: "rgba(34,197,94,0.12)", color: "#16a34a", border: "1px solid rgba(34,197,94,0.3)" },
  stopped: { background: "rgba(148,163,184,0.12)", color: "#64748b", border: "1px solid rgba(148,163,184,0.3)" },
  stale:   { background: "rgba(245,158,11,0.12)", color: "#d97706", border: "1px solid rgba(245,158,11,0.3)" },
  error:   { background: "rgba(220,38,38,0.12)", color: "#dc2626", border: "1px solid rgba(220,38,38,0.3)" },
};

function StatusPill({ status, error }) {
  if (error)               return <span style={{ ...PILL.base, ...PILL.error }}>error</span>;
  if (!status)             return <span style={{ ...PILL.base, ...PILL.stopped }}>loading</span>;
  if (status.isStale)      return <span style={{ ...PILL.base, ...PILL.stale }}>stale</span>;
  if (status.running)      return <span style={{ ...PILL.base, ...PILL.running }}>running</span>;
  return <span style={{ ...PILL.base, ...PILL.stopped }}>stopped</span>;
}

function MetricRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12 }}>
      <span style={{ color: "var(--text3)" }}>{label}</span>
      <span style={{ fontFamily: "monospace", color: "var(--text)" }}>{value}</span>
    </div>
  );
}

export default function MwQueuePanel() {
  const { status, loading, error, refresh } = useMwQueueStatus({ pollMs: 5000 });
  const [busy, setBusy]     = useState(null);   // 'start' | 'stop' | 'runOnce' | null
  const [actionMsg, setMsg] = useState(null);

  async function handleStart() {
    setBusy("start");
    try {
      await startWorker();
      setMsg("Worker started.");
      await refresh();
    } catch (err) {
      setMsg("Start failed: " + err.message);
    } finally {
      setBusy(null);
    }
  }
  async function handleStop() {
    setBusy("stop");
    try {
      await stopWorker();
      setMsg("Worker stopped — queue won't drain until restarted.");
      await refresh();
    } catch (err) {
      setMsg("Stop failed: " + err.message);
    } finally {
      setBusy(null);
    }
  }
  async function handleRunOnce() {
    setBusy("runOnce");
    try {
      const { summary } = await runOnce();
      setMsg(`Ran one cycle — processed=${summary.processed} errors=${summary.errors} skipped=${summary.skipped}.`);
      await refresh();
    } catch (err) {
      setMsg("Run-once failed: " + err.message);
    } finally {
      setBusy(null);
    }
  }

  const cardStyle = {
    background: "#fff",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  };
  const headerStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 };
  const btnStyle = (kind) => ({
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: kind === "primary" ? "var(--accent)" : "#fff",
    color: kind === "primary" ? "#fff" : "var(--text)",
    cursor: busy ? "wait" : "pointer",
    opacity: busy ? 0.6 : 1,
  });

  const lastResult = status && status.lastResult;
  const lastSummary = lastResult
    ? `processed=${lastResult.processed ?? 0} · errors=${lastResult.errors ?? 0} · skipped=${lastResult.skipped ?? 0}`
    : "—";

  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>OMS → TMS Queue Worker</div>
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
            Drains <code>mw_requests</code> on the API server. No browser tab required.
          </div>
        </div>
        <StatusPill status={status} error={error} />
      </div>

      {loading && !status ? (
        <div style={{ fontSize: 12, color: "var(--text3)" }}>Loading…</div>
      ) : (
        <>
          <MetricRow label="Interval" value={status ? `${status.intervalMs} ms` : "—"} />
          <MetricRow label="In flight" value={status ? (status.inFlight ? "yes" : "no") : "—"} />
          <MetricRow label="Last tick" value={status ? status.lastRunAtLabel : "—"} />
          <MetricRow
            label="Seconds since"
            value={status && status.secondsSince !== null ? `${status.secondsSince}s` : "—"}
          />
          <MetricRow label="Last result" value={lastSummary} />
          {status && status.lastError && (
            <div style={{ fontSize: 11, color: "#dc2626", marginTop: 6 }}>Last error: {status.lastError}</div>
          )}
        </>
      )}

      <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={btnStyle("primary")} disabled={!!busy || (status && status.running)} onClick={handleStart}>
          {busy === "start" ? "Starting…" : "Start"}
        </button>
        <button style={btnStyle()} disabled={!!busy || (status && !status.running)} onClick={handleStop}>
          {busy === "stop" ? "Stopping…" : "Stop"}
        </button>
        <button style={btnStyle()} disabled={!!busy} onClick={handleRunOnce}>
          {busy === "runOnce" ? "Running…" : "Run Once"}
        </button>
        <button style={btnStyle()} disabled={!!busy} onClick={refresh}>
          Refresh
        </button>
      </div>

      {error && (
        <div style={{ fontSize: 11, color: "#dc2626", marginTop: 10 }}>Status fetch failed: {error}</div>
      )}
      {actionMsg && (
        <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 10 }}>{actionMsg}</div>
      )}
    </div>
  );
}
