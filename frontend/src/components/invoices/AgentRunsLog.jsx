// Agent runs: every time the invoice agent read carrier invoices for this
// domain — on the mailbox timer or when someone pressed Read AP Mailbox —
// and what each run produced. Click a run for its invoices; click an
// invoice for the same review drawer as the AP review tab.
import { useMemo, useState } from "react";
import { useIntakeRuns, useIntakeRun } from "../../hooks/useIntakeRuns";
import { INTAKE_OUTCOME, RUN_STATUS, runDuration, runEvery } from "../../services/invoiceIntakeService";
import InvoiceIntakeDrawer from "./InvoiceIntakeDrawer";
import { TONE, Pill, StatCard, money, dateTime } from "./intakeUi";

const num = (n) => (n == null ? "—" : n);

function TriggerBadge({ run }) {
  const scheduled = run.trigger === "schedule";
  const t = scheduled ? TONE.info : TONE.none;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 9px", borderRadius: 6, fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", background: t.bg, color: t.fg, border: `1px solid ${t.line}` }}>
      {scheduled ? "⏱ Scheduled" : "👆 Manual"}
    </span>
  );
}

function ScheduleBanner({ schedule }) {
  if (!schedule) return null;
  const text = schedule.on
    ? `The agent checks ${schedule.mailbox} every ${runEvery(schedule.everySec)}. Last check ${dateTime(schedule.lastCheckAt)}. Checks that find nothing are not listed.`
    : `The mailbox timer is off for ${schedule.mailbox || "the AP mailbox"}: invoices are read when someone presses 📬 Read AP Mailbox.`;
  return (
    <div className="ap-card" style={{ padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#334155", display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: schedule.on ? "#10B981" : "#94A3B8" }} />
      {text}
    </div>
  );
}

function RunInvoices({ runId, onOpen }) {
  const { detail, loading, error } = useIntakeRun(runId);
  if (loading) return <div style={{ padding: 14, color: "#94A3B8", fontSize: 13 }}>Loading the invoices from this run…</div>;
  if (error) return <div style={{ padding: 14, color: "#B91C1C", fontSize: 13 }}>{error}</div>;
  const entries = detail?.entries || [];
  if (!entries.length) return <div style={{ padding: 14, color: "#64748B", fontSize: 13 }}>No new carrier invoices in this run.</div>;
  return (
    <table className="ap-table" style={{ background: "#F8FAFC" }}>
      <thead>
        <tr><th>Invoice</th><th>Carrier</th><th>Shipment</th><th style={{ textAlign: "right" }}>Total</th><th>Outcome</th><th>Audit result</th></tr>
      </thead>
      <tbody>
        {entries.map((e) => {
          const meta = INTAKE_OUTCOME[e.outcome] || { label: e.outcome, tone: "none" };
          return (
            <tr key={e.intakeId} onClick={() => onOpen(e.intakeId)} title="Open the review">
              <td><div style={{ fontWeight: 600 }}>{e.invoiceNumber || e.fileName}</div><div style={{ fontSize: 11.5, color: "#94A3B8" }}>{e.fileName}</div></td>
              <td>{e.carrier || "—"}</td>
              <td className="mono">{e.shipmentRef || "—"}</td>
              <td style={{ textAlign: "right", fontWeight: 600 }}>{money(e.total)}</td>
              <td><Pill tone={meta.tone}>{meta.label}</Pill></td>
              <td style={{ fontSize: 12.5, color: "#475569", maxWidth: 280 }}>{e.shortReason || "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function AgentRunsLog({ refreshKey, canDecide, onChanged }) {
  const { runs, schedule, loading, error, reload } = useIntakeRuns(refreshKey);
  const [openRun, setOpenRun] = useState(null);
  const [openIntake, setOpenIntake] = useState(null);
  const [filter, setFilter] = useState("");

  const stats = useMemo(() => ({
    scheduled: runs.filter((r) => r.trigger === "schedule").length,
    manual: runs.filter((r) => r.trigger === "manual").length,
    documents: runs.reduce((s, r) => s + (r.counts?.documents || 0), 0),
    failed: runs.filter((r) => r.status === "failed" || r.status === "interrupted").length,
  }), [runs]);
  const shown = useMemo(() => runs.filter((r) => !filter
    || (filter === "failed" ? (r.status === "failed" || r.status === "interrupted") : r.trigger === filter)), [runs, filter]);

  if (loading) return <div style={{ padding: 20, color: "#94A3B8" }}>Loading…</div>;
  if (error) return <div className="ap-card" style={{ padding: 14, color: "#B91C1C", fontSize: 13 }}>{error}</div>;

  return (
    <div>
      <ScheduleBanner schedule={schedule} />
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <StatCard label="Agent runs" value={runs.length} sub="newest 50" active={!filter} onClick={() => setFilter("")} />
        <StatCard label="Scheduled" value={stats.scheduled} sub="mailbox timer" tone="info" active={filter === "schedule"} onClick={() => setFilter(filter === "schedule" ? "" : "schedule")} />
        <StatCard label="Manual" value={stats.manual} sub="Read AP Mailbox / folder" active={filter === "manual"} onClick={() => setFilter(filter === "manual" ? "" : "manual")} />
        <StatCard label="Invoices read" value={stats.documents} sub="across these runs" />
        <StatCard label="Failed runs" value={stats.failed} tone={stats.failed ? "bad" : undefined} active={filter === "failed"} onClick={() => setFilter(filter === "failed" ? "" : "failed")} />
        <button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: "auto", alignSelf: "center" }} onClick={reload}>Refresh</button>
      </div>

      {!runs.length ? (
        <div className="ap-card" style={{ padding: 28, textAlign: "center", color: "#475569" }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No agent runs yet</div>
          <div style={{ fontSize: 13 }}>Press <b>📬 Read AP Mailbox</b>, or turn on the mailbox timer, and each run is logged here.</div>
        </div>
      ) : (
        <div className="ap-card" style={{ overflow: "hidden" }}>
          <table className="ap-table">
            <thead>
              <tr>
                <th>Started</th><th>How</th><th>Started by</th><th>Mailbox</th>
                <th style={{ textAlign: "right" }} title="New emails read in this run">Emails</th>
                <th style={{ textAlign: "right" }} title="Invoice documents read">Invoices</th>
                <th style={{ textAlign: "right" }}>Ready</th><th style={{ textAlign: "right" }}>Held</th>
                <th style={{ textAlign: "right" }}>Duplicate</th><th style={{ textAlign: "right" }} title="Needs manual entry or failed">Other</th>
                <th>Duration</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const st = RUN_STATUS[r.status] || { label: r.status, tone: "none" };
                const c = r.counts || {};
                const open = openRun === r.id;
                return [
                  <tr key={r.id} onClick={() => setOpenRun(open ? null : r.id)} style={{ background: open ? "#F8FAFC" : undefined }} title={open ? "Hide the invoices" : "Show the invoices from this run"}>
                    <td style={{ whiteSpace: "nowrap" }}>{open ? "▾" : "▸"} {dateTime(r.startedAt)}</td>
                    <td><TriggerBadge run={r} /><div style={{ fontSize: 11.5, color: "#94A3B8", marginTop: 3 }}>{r.label}</div></td>
                    <td style={{ fontSize: 12.5 }}>{r.trigger === "schedule" ? "Timer" : r.startedBy}</td>
                    <td style={{ fontSize: 12.5, color: "#475569" }}>{r.mailbox || (r.channel === "inbox_folder" ? "Inbox folder" : "—")}</td>
                    <td style={{ textAlign: "right" }}>{num(r.emailsRead)}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{c.documents || 0}</td>
                    <td style={{ textAlign: "right", color: "#047857" }}>{c.ready_to_post || 0}</td>
                    <td style={{ textAlign: "right", color: "#C2410C" }}>{(c.needs_review || 0) + (c.disputed || 0)}</td>
                    <td style={{ textAlign: "right" }}>{c.duplicate || 0}</td>
                    <td style={{ textAlign: "right" }}>{(c.needs_manual || 0) + (c.failed || 0) + (c.deleted || 0)}</td>
                    <td style={{ whiteSpace: "nowrap", color: "#475569" }}>{runDuration(r.durationMs)}</td>
                    <td><Pill tone={st.tone}>{st.label}</Pill>{r.error && <div style={{ fontSize: 11.5, color: "#B91C1C", marginTop: 3, maxWidth: 220 }}>{r.error}</div>}</td>
                  </tr>,
                  open && (
                    <tr key={`${r.id}-docs`} style={{ cursor: "default" }}>
                      <td colSpan={12} style={{ padding: 0 }}><RunInvoices runId={r.id} onOpen={setOpenIntake} /></td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      {!!runs.length && !shown.length && <div style={{ padding: 16, color: "#94A3B8" }}>Nothing matches.</div>}
      <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 10 }}>Counts follow each invoice’s current outcome, so they change when AP approves or disputes.</div>

      {openIntake && (
        <InvoiceIntakeDrawer intakeId={openIntake} canDecide={canDecide} onClose={() => setOpenIntake(null)}
          onChanged={() => { reload(); if (onChanged) onChanged(); }} />
      )}
    </div>
  );
}
