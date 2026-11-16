// Approval queue: every invoice the agent held for a person, riskiest first,
// with the agent's reasoning and an approve / dispute decision on each row.
import { Fragment, useMemo, useState } from "react";
import { useInvoiceIntakeLog } from "../../hooks/useInvoiceIntakeLog";
import { resolveException, MIN_JUSTIFICATION } from "../../services/apReleaseService";
import { readableReason } from "../../services/invoiceService";
import InvoiceIntakeDrawer from "./InvoiceIntakeDrawer";
import { RiskPill, StatCard, money } from "./intakeUi";

const RISK_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function minutesText(m) {
  if (m == null) return "—";
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 6) / 10;
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
}

export default function ApprovalQueue({ refreshKey, canDecide, onChanged, onGoToRelease }) {
  const { entries, summary, loading, error, reload } = useInvoiceIntakeLog(refreshKey);
  const [pending, setPending] = useState(null); // { intakeId, invoiceId, action }
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [openId, setOpenId] = useState(null);

  const queue = useMemo(() => entries
    .filter((e) => e.outcome === "needs_review" && e.invoiceId)
    .sort((a, b) => (RISK_ORDER[a.risk] ?? 9) - (RISK_ORDER[b.risk] ?? 9)), [entries]);
  const q = summary?.queue || {};

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setMsg("");
    try {
      await resolveException(pending.invoiceId, pending.action, comment);
      setMsg(`${pending.label} ${pending.action === "approve" ? "exception approved — it is not export-eligible until it is revalidated and released under Release & export" : "disputed with the carrier — blocked from export"}.`);
      setPending(null);
      setComment("");
      reload();
      if (onChanged) onChanged();
    } catch (e) {
      setMsg(e?.message || "Could not save the decision");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div style={{ padding: 20, color: "#94A3B8" }}>Loading…</div>;
  if (error) return <div className="ap-card" style={{ padding: 14, color: "#B91C1C", fontSize: 13 }}>{error}</div>;

  return (
    <div>
      <div className="ap-card" style={{ marginBottom: 16, overflow: "hidden" }}>
        <div style={{ padding: "16px 18px 6px" }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>Approval queue</div>
          <div style={{ fontSize: 13, color: "#64748B" }}>Invoices the agent paused for a person before anything is released. Riskiest first. Every decision needs a written justification and is kept in the audit history.</div>
        </div>
        {msg && (
          <div style={{ margin: "8px 18px", padding: "8px 12px", borderRadius: 8, background: "#F0FDF4", color: "#166534", fontSize: 13, display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ flex: 1 }}>{msg}</span>
            {onGoToRelease && /approved/.test(msg) && <button type="button" className="btn btn-secondary btn-sm" onClick={onGoToRelease}>Go to Release &amp; export →</button>}
          </div>
        )}
        <table className="ap-table" style={{ marginTop: 6 }}>
          <thead>
            <tr><th>Invoice</th><th style={{ textAlign: "right" }}>Amount</th><th>Risk</th><th>Reasoning</th><th>Decision</th></tr>
          </thead>
          <tbody>
            {queue.map((e) => (
              <Fragment key={e.intakeId}>
                <tr onClick={() => setOpenId(e.intakeId)} title="Open the full review">
                  <td>
                    <div style={{ fontWeight: 700 }}>{e.invoiceNumber || e.fileName}</div>
                    <div style={{ fontSize: 11.5, color: "#94A3B8" }}>{e.carrier} · {e.shipmentRef || "no shipment"}</div>
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{money(e.total)}</td>
                  <td><RiskPill risk={e.risk} /></td>
                  <td style={{ color: "#475569", fontSize: 12.5, maxWidth: 520 }}>
                    <div style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{readableReason(e.reason)}</div>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }} onClick={(ev) => ev.stopPropagation()}>
                    {canDecide ? (
                      <>
                        <button type="button" className="btn btn-sm" style={{ background: "#DCFCE7", color: "#166534", marginRight: 6 }}
                          onClick={() => { setPending({ intakeId: e.intakeId, invoiceId: e.invoiceId, action: "approve", label: e.invoiceNumber }); setComment(""); }}>Approve</button>
                        <button type="button" className="btn btn-sm" style={{ background: "#FEE2E2", color: "#B91C1C" }}
                          onClick={() => { setPending({ intakeId: e.intakeId, invoiceId: e.invoiceId, action: "dispute", label: e.invoiceNumber }); setComment(""); }}>Dispute</button>
                      </>
                    ) : <span style={{ color: "#94A3B8", fontSize: 12 }}>View only</span>}
                  </td>
                </tr>
                {pending && pending.intakeId === e.intakeId && (
                  <tr style={{ background: "#F8FAFC", cursor: "default" }}>
                    <td colSpan={5}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
                          {pending.action === "approve" ? "Approve" : "Dispute"} {pending.label} —
                        </span>
                        <input autoFocus value={comment} onChange={(ev) => setComment(ev.target.value)}
                          placeholder={pending.action === "approve" ? `Justification — why this exception is OK to pay (required, ${MIN_JUSTIFICATION}+ characters)` : `What to tell the carrier (required, ${MIN_JUSTIFICATION}+ characters)`}
                          style={{ flex: 1, height: 36, padding: "0 10px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: 13 }} />
                        <button type="button" className="btn btn-primary btn-sm" disabled={busy || comment.trim().length < MIN_JUSTIFICATION} onClick={confirm}
                          style={{ background: pending.action === "approve" ? "#16A34A" : "#DC2626" }}>
                          {busy ? "Saving…" : `Confirm ${pending.action}`}
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!queue.length && (
              <tr style={{ cursor: "default" }}><td colSpan={5} style={{ textAlign: "center", padding: 28, color: "#64748B" }}>Nothing waiting for a person.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="ap-card" style={{ padding: "16px 18px" }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Queue statistics</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <StatCard label="Pending reviews" value={q.pending ?? queue.length} />
          <StatCard label="Approved by AP (7 days)" value={q.approved7d ?? 0} tone="ok" />
          <StatCard label="Disputed (7 days)" value={q.disputed7d ?? 0} tone="bad" />
          <StatCard label="Avg. review time" value={minutesText(q.avgReviewMinutes)} sub="received → decided" />
          <StatCard label="Active reviewers" value={q.reviewers ?? 0} />
        </div>
      </div>

      {openId && (
        <InvoiceIntakeDrawer intakeId={openId} canDecide={canDecide} onClose={() => setOpenId(null)}
          onChanged={() => { reload(); if (onChanged) onChanged(); }} />
      )}
    </div>
  );
}
