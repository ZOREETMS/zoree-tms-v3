// Review drawer for one invoice document: what was read, each line billed
// vs expected, the activity, and AP's approve / dispute decision.
import { useEffect, useState } from "react";
import ShipmentLink from "../shipments/ShipmentLink";
import { useInvoiceIntakeDetail } from "../../hooks/useInvoiceIntakeDetail";
import { INTAKE_OUTCOME, LINE_STATUS, SENDER_STATUS, paymentEligibility } from "../../services/invoiceIntakeService";
import { MIN_JUSTIFICATION } from "../../services/apReleaseService";
import { TONE, Pill, FieldConfidence, money, pct, dateTime } from "./intakeUi";

const SOURCE = { email: "AP mailbox", pdf_upload: "PDF upload" };
const MARK = { ok: "✓", warn: "!", bad: "▲" };

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.2, color: "#64748B", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ label, children, conf }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "7px 0", fontSize: 13, borderBottom: "1px solid #F1F5F9" }}>
      <span style={{ width: 150, color: "#475569", fontWeight: 600 }}>{label}</span>
      <span style={{ flex: 1 }}>{children}</span>
      {conf !== undefined && <FieldConfidence value={conf} />}
    </div>
  );
}

/** The email the invoice arrived in, with the sender check next to it. */
function SourceEmail({ d }) {
  const m = d.sourceEmail;
  if (!m) return null;
  const s = d.senderCheck;
  const sm = s ? SENDER_STATUS[s.status] || SENDER_STATUS.not_checked : null;
  return (
    <Section title="Source email">
      <div style={{ display: "flex", gap: 10, padding: "10px 0" }}>
        <span style={{ width: 34, height: 34, borderRadius: 17, background: "#7F1D1D", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
          {String(m.fromName || m.from || "?").slice(0, 2).toUpperCase()}
        </span>
        <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <b>{m.fromName || m.from}</b>
            <span style={{ marginLeft: "auto", color: "#64748B", fontSize: 12, whiteSpace: "nowrap" }}>{dateTime(m.receivedAt)}</span>
          </div>
          <div style={{ color: "#64748B", fontSize: 12 }}>{m.from} → {m.mailbox}</div>
          <div style={{ color: "#1D4ED8", marginTop: 2 }}>{m.subject || "(no subject)"}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            {(m.attachments || []).map((a) => (
              <span key={a} style={{ fontSize: 11.5, padding: "2px 8px", border: "1px solid #E2E8F0", borderRadius: 6, background: "#fff" }}>📎 {a}</span>
            ))}
            {sm && <Pill tone={sm.tone}>Sender {sm.label.toLowerCase()}</Pill>}
          </div>
        </div>
      </div>
    </Section>
  );
}

function PaymentChecks({ d }) {
  const s = d.senderCheck;
  const sm = s ? SENDER_STATUS[s.status] || SENDER_STATUS.not_checked : null;
  const pay = paymentEligibility(d.entry.outcome);
  const held = s && (s.status === "unverified" || s.status === "unregistered");
  return (
    <Section title="Payment checks">
      <Row label="Invoice audit">{d.audit ? <Pill tone="ok">Completed</Pill> : <Pill tone="warn">Not run</Pill>}</Row>
      {s && <Row label="Sender">{s.sender || "—"}</Row>}
      {s && <Row label="Sender verification"><Pill tone={sm.tone}>{sm.label}</Pill></Row>}
      <Row label="Payment eligibility"><Pill tone={pay.tone}>{pay.label}</Pill></Row>
      {held && d.entry.outcome === "needs_review" && (
        <div style={{ marginTop: 10, padding: 12, borderRadius: 8, background: "#EFF6FF", border: "1px solid #BFDBFE", fontSize: 12.5 }}>
          <b>Agent recommendation.</b> The invoice audit is complete, but AP must verify the sender through an established carrier contact before releasing it. {s.detail}
        </div>
      )}
    </Section>
  );
}

function FieldsTab({ d }) {
  const e = d.entry;
  return (
    <>
      <PaymentChecks d={d} />
      <SourceEmail d={d} />
      <Section title="Extracted by Zoree AI">
        {(() => {
          const low = d.fields.filter((f) => f.confidence != null && f.confidence < 0.9);
          return low.length > 0 && (
            <div style={{ margin: "8px 0", padding: "8px 10px", borderRadius: 8, background: "#FFFBEB", border: "1px solid #FDE68A", fontSize: 12.5, color: "#92400E" }}>
              ⚠ {low.length} field{low.length > 1 ? "s have" : " has"} low confidence: {low.map((f) => f.label).join(", ")}. Check against the source before approving.
            </div>
          );
        })()}
        {d.fields.map((f) => <Row key={f.label} label={f.label} conf={f.confidence}>{f.label === "Total" ? money(f.value) : String(f.value)}</Row>)}
      </Section>
      {d.shipment && (
        <Section title="Shipment in the TMS">
          <Row label="Shipment"><ShipmentLink id={d.shipment.id}>{d.shipment.id} →</ShipmentLink></Row>
          <Row label="Status">{d.shipment.status}</Row>
          <Row label="Carrier">{d.shipment.carrier || "—"}</Row>
        </Section>
      )}
      <Section title="Source document">
        <Row label="File">📄 {e.fileName}</Row>
        <Row label="Arrived by">{SOURCE[e.source] || e.source}</Row>
        <Row label="Received">{dateTime(e.receivedAt)}</Row>
        {!d.hasFile && <Row label="Original">Not kept (read before documents were stored)</Row>}
      </Section>
      {d.invoice && (
        <div style={{ padding: 12, borderRadius: 8, background: "#FFFBEB", border: "1px solid #FDE68A", fontSize: 12.5 }}>
          <div>Billed on the invoice: <b>{money(d.invoice.invoicedAmount)}</b></div>
          <div>Expected from the TMS and contract: <b>{d.invoice.agreedCost != null ? money(d.invoice.agreedCost) : "nothing on file"}</b></div>
          {Number(d.invoice.variance) > 0 && <div style={{ color: "#B91C1C" }}>Difference: <b>{money(d.invoice.variance)}</b></div>}
        </div>
      )}
    </>
  );
}

function LinesTab({ d }) {
  return (
    <>
      <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#EEF2FF" }}>
            <th style={{ textAlign: "left", padding: "8px 10px" }}>Line item</th>
            <th style={{ textAlign: "right", padding: "8px 10px" }}>Expected</th>
            <th style={{ textAlign: "right", padding: "8px 10px" }}>Invoiced</th>
          </tr>
        </thead>
        <tbody>
          {d.lines.map((l, i) => {
            const meta = LINE_STATUS[l.status] || LINE_STATUS.not_checked;
            const t = TONE[meta.tone];
            return (
              <tr key={`${l.description}-${i}`} style={{ borderBottom: "1px solid #F1F5F9" }}>
                <td style={{ padding: "10px" }}>
                  <div style={{ fontWeight: 600 }}>{l.description}</div>
                  <div style={{ marginTop: 4 }}><Pill tone={meta.tone}>{MARK[meta.tone]} {meta.label}</Pill></div>
                  {l.note && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>{l.note}</div>}
                </td>
                <td style={{ padding: "10px", textAlign: "right", fontWeight: 700, color: t.fg, whiteSpace: "nowrap" }}>{l.expected == null ? "—" : money(l.expected)}</td>
                <td style={{ padding: "10px", textAlign: "right", whiteSpace: "nowrap" }}>
                  {money(l.billed)}
                  {l.difference > 1 && <div style={{ fontSize: 11, color: "#B91C1C" }}>+{money(l.difference)}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {d.audit && (
        <div style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: 8 }}>
          <div style={{ padding: "8px 12px", fontWeight: 700, fontSize: 13, borderBottom: "1px solid var(--border)" }}>Audit summary</div>
          {d.audit.issues.map((x) => <div key={x.detail} style={{ padding: "8px 12px", fontSize: 12.5, color: "#B91C1C", borderBottom: "1px solid #F1F5F9" }}>▲ {x.detail}</div>)}
          {d.audit.passed.map((x) => <div key={x} style={{ padding: "8px 12px", fontSize: 12.5, color: "#047857", borderBottom: "1px solid #F1F5F9" }}>✓ {x}</div>)}
          {d.audit.recoverable > 0 && <div style={{ padding: "8px 12px", fontSize: 12.5, fontWeight: 700 }}>Overbilled: {money(d.audit.recoverable)}</div>}
        </div>
      )}
    </>
  );
}

function ActivityTab({ d }) {
  return (
    <div>
      {d.activity.map((a, i) => (
        <div key={`${a.at}-${i}`} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: "1px solid #F1F5F9", fontSize: 12.5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--accent)", marginTop: 5, flexShrink: 0 }} />
          <div>
            <div>{a.text}</div>
            <div style={{ fontSize: 11, color: "var(--text3)" }}>{a.who} · {dateTime(a.at)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

const TABS = [["fields", "Extracted fields"], ["lines", "Line items"], ["activity", "Activity"]];

export default function InvoiceIntakeDrawer({ intakeId, canDecide, onClose, onChanged }) {
  const { detail: d, error, busy, decide, fileUrl } = useInvoiceIntakeDetail(intakeId, onChanged);
  const [tab, setTab] = useState("fields");
  const [comment, setComment] = useState("");
  const meta = d ? INTAKE_OUTCOME[d.entry.outcome] || { label: d.entry.outcome, tone: "bad" } : null;
  const open = d && d.entry.outcome === "needs_review" && d.invoice && !d.isDuplicate;

  // Esc closes the drawer, like any panel.
  useEffect(() => {
    const onKey = (ev) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
    <div onClick={onClose} title="Close" style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.25)", zIndex: 899 }} />
    <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: fileUrl ? "min(1500px, 96vw)" : "min(500px, 100vw)", background: "#fff", zIndex: 900, boxShadow: "-12px 0 32px rgba(15,23,42,.14)", display: "flex" }}>
      {fileUrl && (
        <div style={{ flex: 1, minWidth: 0, background: "#334155", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "8px 14px", color: "#E2E8F0", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Original document · {d?.entry?.fileName}</span>
            <a href={fileUrl} target="_blank" rel="noreferrer" style={{ color: "#fff", textDecoration: "underline", whiteSpace: "nowrap" }}>Open full size ↗</a>
          </div>
          {/* Viewer toolbar on: zoom with its + / − buttons; the pane scrolls instead of cutting off. */}
          <iframe title="Original invoice" src={`${fileUrl}#navpanes=0&view=FitH`} style={{ flex: 1, minHeight: 0, border: "none", background: "#fff" }} />
        </div>
      )}
      <div style={{ width: fileUrl ? "min(500px, 45%)" : "100%", flexShrink: 0, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--border)" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose} title="Back to the list (Esc)">←</button>
          <div style={{ fontWeight: 700, fontSize: 15, flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{d ? d.entry.fileName : "Loading…"}</div>
          <button type="button" onClick={onClose} title="Close (Esc)" style={{
            background: "#F1F5F9", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 12px",
            fontSize: 12.5, fontWeight: 600, color: "var(--text)", cursor: "pointer", flexShrink: 0,
          }}>✕ Close</button>
        </div>
        {d && (
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <Pill tone={meta.tone}>{meta.label}</Pill>
            <Pill tone={d.entry.confidence >= 0.9 ? "ok" : "warn"}>{pct(d.entry.confidence)} read confidence</Pill>
            {d.entry.invoiceNumber && <Pill>{d.entry.invoiceNumber}</Pill>}
            {d.entry.total != null && <Pill>{money(d.entry.total)}</Pill>}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 18, padding: "0 18px", borderBottom: "1px solid var(--border)" }}>
        {TABS.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} style={{
            padding: "10px 0", fontSize: 12.5, fontWeight: 600, background: "none", border: "none", cursor: "pointer",
            color: tab === key ? "var(--accent)" : "var(--text2)", borderBottom: tab === key ? "2px solid var(--accent)" : "2px solid transparent",
          }}>
            {label}{key === "lines" && d ? ` (${d.lines.length})` : ""}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 18 }}>
        {error && <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{error}</div>}
        {d && d.entry.outcome !== "ready_to_post" && d.entry.reason && (
          <div style={{ padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 12.5, background: TONE[meta.tone].bg, color: TONE[meta.tone].fg, border: `1px solid ${TONE[meta.tone].line}` }}>
            <b>{meta.label}.</b> {d.entry.reason.replace(/^Needs AP review:\s*/i, "")}
            {d.warnings.length > 0 && <div style={{ marginTop: 4 }}>{d.warnings.join(" ")}</div>}
          </div>
        )}
        {d && tab === "fields" && <FieldsTab d={d} />}
        {d && tab === "lines" && <LinesTab d={d} />}
        {d && tab === "activity" && <ActivityTab d={d} />}
      </div>

      {open && canDecide && (
        <div style={{ padding: 14, borderTop: "1px solid var(--border)" }}>
          <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder={`Justification for the audit history (required, ${MIN_JUSTIFICATION}+ characters)`}
            style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: 12.5, marginBottom: 10 }} />
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} disabled={busy || comment.trim().length < MIN_JUSTIFICATION} onClick={() => decide("dispute", comment)}>Dispute with carrier</button>
            <button className="btn btn-primary" style={{ flex: 1, background: "#16A34A" }} disabled={busy || comment.trim().length < MIN_JUSTIFICATION} onClick={() => decide("approve", comment)}>Approve invoice</button>
          </div>
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 8 }}>A person decides. Nothing is paid by the agent. An approved exception still has to be revalidated and released before it can be exported.</div>
        </div>
      )}
      </div>
    </div>
    </>
  );
}
