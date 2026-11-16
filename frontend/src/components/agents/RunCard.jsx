// One agent run: summary, the evidence it used, and the actions it proposed.
import { useEffect, useState } from "react";
import { ui } from "./styles";
import ActionCard from "./ActionCard";
import { FINDINGS } from "./findings";
import { RUN_STATUS_TONE } from "../../services/agentsService";

const when = (s) => (s ? new Date(s).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

export default function RunCard({ run, actionTypes, defaultOpen }) {
  const [showFindings, setShowFindings] = useState(!!defaultOpen);
  // A run can mount while still running (list refetch) before it becomes the
  // latest result; open its evidence once it does.
  useEffect(() => { if (defaultOpen) setShowFindings(true); }, [defaultOpen]);
  const tone = RUN_STATUS_TONE[run.status] || RUN_STATUS_TONE.completed;
  const findings = run.input && run.input._findings;
  const Findings = FINDINGS[run.agent];
  const secs = run.finished_at || run.updated_at ? Math.max(0, Math.round((new Date(run.finished_at || run.updated_at) - new Date(run.started_at)) / 1000)) : null;

  return (
    <div style={ui.card}>
      <div style={ui.row}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>{run.summary || (run.status === "failed" ? "Run failed" : "Working…")}</div>
          <div style={ui.muted}>{when(run.started_at)} · by {run.created_by}{run.model ? ` · ${run.model}` : ""}{secs !== null && run.status !== "running" ? ` · ${secs}s` : ""}</div>
        </div>
        <span style={ui.chip(tone.bg, tone.fg)}>{tone.label}</span>
      </div>
      {run.error && <div style={ui.err}>{run.error}</div>}
      {findings && Findings && (
        <div style={{ marginTop: 8 }}>
          <button style={ui.link} onClick={() => setShowFindings(!showFindings)}>{showFindings ? "Hide" : "Show"} what the agent checked</button>
          {showFindings && <div style={{ marginTop: 8 }}><Findings f={findings} /></div>}
        </div>
      )}
      {(run.actions || []).map((a) => <ActionCard key={`${a.id}:${a.status}`} action={a} actionLabel={(actionTypes[a.action_type] || {}).label || a.action_type} />)}
      {run.status === "running" && <div style={{ ...ui.muted, marginTop: 8 }}>Reading and rating…</div>}
      {!["failed", "running"].includes(run.status) && (run.actions || []).length === 0 && <div style={{ ...ui.muted, marginTop: 8 }}>Nothing to do — no actions proposed.</div>}
    </div>
  );
}
