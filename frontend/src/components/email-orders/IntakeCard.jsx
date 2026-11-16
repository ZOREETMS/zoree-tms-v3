// Confirmation card for one email: what the AI read, what it would create,
// and the human decision (Create order / Reject).
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import DraftEditor from "./DraftEditor";
import { ui } from "./styles";
import {
  approveIntake, rejectIntake, retryIntake, getIntake,
  draftGaps, blocksApproval, confidenceTone, summarizeCreatedOrders,
} from "../../services/emailIntakeService";

const fmtDate = (s) => (s ? new Date(s).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

export default function IntakeCard({ item, onChanged, onCreated }) {
  const navigate = useNavigate();
  const ex = item.extracted || {};
  const [drafts, setDrafts] = useState(() => JSON.parse(JSON.stringify(ex.approved_drafts || ex.drafts || [])));
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [body, setBody] = useState(null);
  const [showBody, setShowBody] = useState(false);

  const pending = item.status === "pending_review";
  const gaps = drafts.map(draftGaps);
  const blocked = gaps.some(blocksApproval);
  const tone = confidenceTone(item.is_order_confidence);
  const orderIds = ex.order_ids || [];

  const updateDraft = (i) => (d) => { setDrafts((p) => p.map((x, j) => (j === i ? d : x))); setEdited(true); };

  async function act(kind, fn) {
    setBusy(kind); setError("");
    try { await fn(); onChanged && onChanged(); }
    catch (e) { setError(e.message); }
    setBusy("");
  }
  const approve = () => act("approve", async () => {
    const res = await approveIntake(item.id, edited ? drafts : undefined);
    onCreated && onCreated(summarizeCreatedOrders(item, drafts, (res && res.orderIds) || []));
  });
  const reject = () => {
    const reason = window.prompt("Reason for rejecting (optional):", "") ?? null;
    if (reason === null) return;
    act("reject", () => rejectIntake(item.id, reason));
  };
  const retry = () => act("retry", () => retryIntake(item.id));
  async function toggleBody() {
    if (!showBody && body === null) {
      try { const full = await getIntake(item.id); setBody(full.body_text || "(body not stored for this email)"); }
      catch (e) { setBody(`Could not load: ${e.message}`); }
    }
    setShowBody(!showBody);
  }

  return (
    <div style={ui.card}>
      <div style={ui.row}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{item.subject || "(no subject)"}</div>
          <div style={ui.muted}>
            {item.from_name ? `${item.from_name} · ` : ""}{item.from_address || "unknown sender"} · {fmtDate(item.received_at)}
            {item.source === "paste" ? " · pasted" : ""}
            {(item.attachment_names || []).length ? ` · 📎 ${item.attachment_names.join(", ")}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {item.is_order_confidence != null && (
            <span style={ui.chip(tone.bg, tone.fg)} title="How sure the AI is that this email is an order">
              {tone.label} · {Math.round(Number(item.is_order_confidence) * 100)}%
            </span>
          )}
          {drafts.length > 1 && <span style={ui.chip("#e0e7ff", "#3730a3")}>{drafts.length} orders</span>}
        </div>
      </div>

      {orderIds.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "8px 12px" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#166534", textTransform: "uppercase", letterSpacing: 0.4 }}>
            {orderIds.length > 1 ? "Orders created" : "Order created"}
          </span>
          {orderIds.map((id) => (
            <button key={id} onClick={() => navigate(`/orders?id=${encodeURIComponent(id)}`)} title="Open order"
              style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 14, color: "#14532d", background: "#dcfce7", border: "1px solid #86efac", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>
              {id} ↗
            </button>
          ))}
          <span style={{ ...ui.muted, marginLeft: "auto" }}>
            {item.reviewed_by ? `by ${item.reviewed_by}` : ""}{item.reviewed_at ? ` · ${fmtDate(item.reviewed_at)}` : ""}{ex.edited ? " · edited before creating" : ""}
          </span>
        </div>
      )}

      {ex.reason && <div style={{ ...ui.muted, marginTop: 6 }}>AI: {ex.reason}</div>}

      {pending && (ex.duplicates || []).length > 0 && (
        <div style={ui.warn}>
          Possible duplicate — PO already in the TMS: {ex.duplicates.map((d) => `${d.po} → ${d.orderId}`).join(", ")}
        </div>
      )}
      {pending && blocked && (
        <div style={ui.warn}>Fill the fields marked * before creating. Missing: {[...new Set(gaps.flat())].join(", ")}</div>
      )}
      {pending && (ex.questions_for_sender || []).length > 0 && (
        <div style={{ ...ui.muted, marginTop: 8 }}>
          <b>Ask the sender:</b> {ex.questions_for_sender.join(" · ")}
        </div>
      )}
      {(ex.skipped_attachments || []).length > 0 && (
        <div style={{ ...ui.muted, marginTop: 4 }}>Not read: {ex.skipped_attachments.join(", ")}</div>
      )}
      {item.error && <div style={ui.err}>{item.error}</div>}

      {drafts.map((d, i) => (
        <DraftEditor key={i} index={i} total={drafts.length} draft={d} gaps={gaps[i]} onChange={updateDraft(i)} readOnly={!pending} />
      ))}

      <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
        {pending && (
          <button style={{ ...ui.btnGreen, opacity: blocked || busy ? 0.5 : 1 }} disabled={blocked || !!busy} onClick={approve}>
            {busy === "approve" ? "Creating…" : `Create ${drafts.length > 1 ? `${drafts.length} orders` : "order"}`}
          </button>
        )}
        {["pending_review", "error", "not_order"].includes(item.status) && (
          <button style={ui.btn2} disabled={!!busy} onClick={reject}>{busy === "reject" ? "…" : "Reject"}</button>
        )}
        {["error", "rejected"].includes(item.status) && (
          <button style={ui.btn2} disabled={!!busy} onClick={retry}>{busy === "retry" ? "Re-reading…" : "Re-run AI"}</button>
        )}
        <button style={ui.link} onClick={toggleBody}>{showBody ? "Hide email" : "Show email"}</button>
        {edited && pending && <span style={ui.muted}>Edited — your changes will be used.</span>}
      </div>
      {error && <div style={ui.err}>{error}</div>}
      {showBody && <div style={ui.pre}>{body}</div>}
    </div>
  );
}
