// One proposed action: what the agent wants to do, editable where allowed,
// and the human decision (Approve / Reject). Nothing executes until approved.
import { useState } from "react";
import { ui } from "./styles";
import { EDITABLE_FIELDS, ACTION_STATUS_TONE, diffEdits, describeResult } from "../../services/agentsService";
import { useApproveAction, useRejectAction } from "../../hooks/useAgents";

const LABELS = { to: "To", subject: "Subject", body: "Message", total_cost: "Total cost ($)", note: "Timeline note", date: "Delivered date", reason: "Reason" };
const MULTILINE = new Set(["body", "note", "reason"]);

function Field({ name, value, onChange, readOnly }) {
  const common = { style: MULTILINE.has(name) ? { ...ui.textarea, minHeight: name === "body" ? 170 : 60 } : { ...ui.input(name === "to" && !value), ...ui.plain }, value: value ?? "", readOnly, onChange: (e) => onChange(name, e.target.value) };
  return (
    <div style={{ marginTop: 8 }}>
      <span style={ui.label}>{LABELS[name] || name}{name === "to" && !value ? " — no address on file, add one to email it" : ""}</span>
      {MULTILINE.has(name) ? <textarea {...common} /> : <input {...common} />}
    </div>
  );
}

export default function ActionCard({ action, actionLabel }) {
  const [open, setOpen] = useState(action.status === "proposed");
  const [draft, setDraft] = useState(() => ({ ...action.payload }));
  const approve = useApproveAction();
  const reject = useRejectAction();
  const proposed = action.status === "proposed";
  const tone = ACTION_STATUS_TONE[action.status] || ACTION_STATUS_TONE.proposed;
  const fields = (EDITABLE_FIELDS[action.action_type] || []).filter((f) => f in action.payload || f === "to");
  const busy = approve.isPending || reject.isPending;
  const error = (approve.error || reject.error)?.message;

  const set = (k, v) => setDraft((p) => ({ ...p, [k]: v }));
  const onApprove = () => approve.mutate({ id: action.id, edits: diffEdits(action.action_type, action.payload, draft) });
  const onReject = () => {
    const reason = window.prompt("Reason for rejecting (optional):", "");
    if (reason !== null) reject.mutate({ id: action.id, reason });
  };

  return (
    <div style={ui.actionCard(action.status)}>
      <div style={ui.row}>
        <div style={{ fontWeight: 600, fontSize: 13.5, flex: 1 }}>{action.title}</div>
        <span style={ui.chip(tone.bg, tone.fg)}>{tone.label}</span>
      </div>
      <div style={{ ...ui.muted, marginTop: 2 }}>
        {actionLabel}{action.decided_by ? ` · ${action.status === "rejected" ? "rejected" : "approved"} by ${action.decided_by}` : ""}
        {!open && fields.length > 0 && <> · <button style={ui.link} onClick={() => setOpen(true)}>details</button></>}
      </div>
      {open && fields.map((f) => <Field key={f} name={f} value={draft[f]} onChange={set} readOnly={!proposed} />)}
      {action.payload.reasons && <div style={{ ...ui.muted, marginTop: 6 }}>{action.payload.reasons.join(" · ")}</div>}
      {action.status === "executed" && <div style={{ ...ui.muted, marginTop: 8, color: "#166534" }}>✓ {describeResult(action)}</div>}
      {action.error && <div style={ui.err}>{action.error}</div>}
      {error && <div style={ui.err}>{error}</div>}
      {proposed && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button style={{ ...ui.btnGreen, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={onApprove}>{approve.isPending ? "Working…" : "Approve"}</button>
          <button style={ui.btn2} disabled={busy} onClick={onReject}>Reject</button>
        </div>
      )}
    </div>
  );
}
