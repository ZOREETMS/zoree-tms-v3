// Tables for the Release & export screen. Presentational: every action is a
// callback from ReleaseQueue, which talks to apReleaseService.
import { Fragment, useState } from "react";
import { RELEASE_PATH, MIN_OVERRIDE_JUSTIFICATION } from "../../services/apReleaseService";
import { Pill, money, dateTime } from "./intakeUi";

const box = { width: 16, height: 16, cursor: "pointer" };

function PathPill({ path }) {
  const p = RELEASE_PATH[path];
  return p ? <span title={p.hint}><Pill tone={p.tone}>{p.label}</Pill></span> : <span style={{ color: "#94A3B8" }}>—</span>;
}

function Header({ title, sub, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px 8px" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
        {sub && <div style={{ fontSize: 12.5, color: "#64748B" }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

function useSelection(rows) {
  const [picked, setPicked] = useState(() => new Set());
  const live = new Set([...picked].filter((id) => rows.some((r) => r.invoiceId === id)));
  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const all = rows.length > 0 && rows.every((r) => live.has(r.invoiceId));
  const toggleAll = () => setPicked(all ? new Set() : new Set(rows.map((r) => r.invoiceId)));
  return { live, toggle, all, toggleAll, clear: () => setPicked(new Set()) };
}

/** Validated invoices waiting for a person to release them. */
export function AwaitingReleaseTable({ rows, total, canDecide, busy, onRelease, onReleaseMany, onHistory }) {
  const sel = useSelection(rows);
  const [note, setNote] = useState("");
  const selectedAmount = rows.filter((r) => sel.live.has(r.invoiceId)).reduce((s, r) => s + r.amount, 0);

  return (
    <div className="ap-card" style={{ marginBottom: 16, overflow: "hidden" }}>
      <Header title={`Ready to release (${rows.length})`} sub={`Validated against shipment + contract rate + approved extras · ${money(total)}. The 3-way match is re-run at the moment of release.`}
        right={canDecide && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12.5, color: "#475569" }}>Selected <b>{money(selectedAmount)}</b></span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Release note (optional)"
              style={{ width: 200, height: 34, padding: "0 10px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: 12.5 }} />
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || !sel.live.size}
              onClick={async () => { await onReleaseMany([...sel.live], note); sel.clear(); setNote(""); }}>
              Release selected ({sel.live.size})
            </button>
          </div>
        )} />
      <table className="ap-table">
        <thead>
          <tr>
            <th style={{ width: 34 }}>{canDecide && <input type="checkbox" style={box} checked={sel.all} onChange={sel.toggleAll} aria-label="Select all" />}</th>
            <th>Invoice</th><th>Shipment</th><th style={{ textAlign: "right" }}>Amount</th><th>Basis</th><th>Revalidation</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Fragment key={r.invoiceId}>
              <tr onClick={() => onHistory(r)} title="Open the audit history">
                <td onClick={(e) => e.stopPropagation()}>
                  {canDecide && <input type="checkbox" style={box} checked={sel.live.has(r.invoiceId)} onChange={() => sel.toggle(r.invoiceId)} aria-label={`Select ${r.invoiceNumber}`} />}
                </td>
                <td><div style={{ fontWeight: 700 }}>{r.invoiceNumber}</div><div style={{ fontSize: 11.5, color: "#94A3B8" }}>{r.carrier}</div></td>
                <td className="mono" style={{ fontSize: 12.5 }}>{r.shipment || "—"}</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{money(r.amount)}</td>
                <td>
                  <PathPill path={r.path} />
                  {r.exceptionApprovedBy && <div style={{ fontSize: 11.5, color: "#64748B", marginTop: 3 }}>Exception approved by {r.exceptionApprovedBy}</div>}
                </td>
                <td style={{ fontSize: 12.5, maxWidth: 300 }}>
                  {r.revalidation?.passes ? <span style={{ color: "#047857" }}>✓ 3-way match passes</span>
                    : <span style={{ color: "#B91C1C" }}>▲ {r.revalidation?.issues?.[0] || "Fails"}</span>}
                </td>
                <td style={{ whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                  {!canDecide ? <span style={{ color: "#94A3B8", fontSize: 12 }}>View only</span> : (
                    <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onRelease(r.invoiceId, note)} style={{ background: "#DCFCE7", color: "#166534" }}>Release</button>
                  )}
                </td>
              </tr>
            </Fragment>
          ))}
          {!rows.length && <tr style={{ cursor: "default" }}><td colSpan={7} style={{ textAlign: "center", padding: 24, color: "#64748B" }}>Nothing waiting to be released.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Released invoices waiting for the next NetSuite export. */
export function ReleasedTable({ rows, total, canDecide, busy, onExport, onHistory }) {
  const sel = useSelection(rows);
  const ids = sel.live.size ? [...sel.live] : null;
  return (
    <div className="ap-card" style={{ marginBottom: 16, overflow: "hidden" }}>
      <Header title={`Released — next NetSuite export (${rows.length})`} sub={`${money(total)} · each invoice can be exported once, ever`}
        right={canDecide && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !rows.length} onClick={async () => { await onExport(ids); sel.clear(); }}
            title="Creates an export batch and downloads its CSV. NetSuite is not written — AP imports the file.">
            ⬇ Export NetSuite CSV ({ids ? ids.length : rows.length})
          </button>
        )} />
      <table className="ap-table">
        <thead>
          <tr>
            <th style={{ width: 34 }}>{canDecide && rows.length > 0 && <input type="checkbox" style={box} checked={sel.all} onChange={sel.toggleAll} aria-label="Select all" />}</th>
            <th>Invoice</th><th>Shipment</th><th style={{ textAlign: "right" }}>Amount</th><th>Release path</th><th>Released by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.invoiceId} onClick={() => onHistory(r)} title="Open the audit history">
              <td onClick={(e) => e.stopPropagation()}>{canDecide && <input type="checkbox" style={box} checked={sel.live.has(r.invoiceId)} onChange={() => sel.toggle(r.invoiceId)} />}</td>
              <td><div style={{ fontWeight: 700 }}>{r.invoiceNumber}</div><div style={{ fontSize: 11.5, color: "#94A3B8" }}>{r.carrier}</div></td>
              <td className="mono" style={{ fontSize: 12.5 }}>{r.shipment || "—"}</td>
              <td style={{ textAlign: "right", fontWeight: 600 }}>{money(r.amount)}</td>
              <td><PathPill path={r.release?.path} />{r.release?.justification && <div style={{ fontSize: 11.5, color: "#92400E", marginTop: 3 }}>“{r.release.justification}”</div>}</td>
              <td style={{ fontSize: 12.5 }}>{r.release?.by}<div style={{ fontSize: 11.5, color: "#94A3B8" }}>{dateTime(r.release?.at)}</div></td>
            </tr>
          ))}
          {!rows.length && <tr style={{ cursor: "default" }}><td colSpan={6} style={{ textAlign: "center", padding: 24, color: "#64748B" }}>Nothing released yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Exceptions and anything else that can't be released, with the reason. */
export function BlockedTable({ rows, onHistory }) {
  return (
    <div className="ap-card" style={{ marginBottom: 16, overflow: "hidden" }}>
      <Header title={`Blocked from export (${rows.length})`} sub="Exceptions stay blocked until the data is fixed — a corrected invoice, an approval in the TMS, or a contract update — and the 3-way match passes. A note alone never releases one." />
      <table className="ap-table">
        <thead><tr><th>Invoice</th><th>Shipment</th><th style={{ textAlign: "right" }}>Amount</th><th>Status</th><th>Why it is blocked</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.invoiceId} onClick={() => onHistory(r)} title="Open the audit history">
              <td><div style={{ fontWeight: 700 }}>{r.invoiceNumber}</div><div style={{ fontSize: 11.5, color: "#94A3B8" }}>{r.carrier}</div></td>
              <td className="mono" style={{ fontSize: 12.5 }}>{r.shipment || "—"}</td>
              <td style={{ textAlign: "right", fontWeight: 600 }}>{money(r.amount)}</td>
              <td><Pill tone={r.status === "Disputed" || r.status === "Rejected" ? "bad" : "warn"}>{r.status || "Blocked"}</Pill></td>
              <td style={{ fontSize: 12.5, color: "#9A3412", maxWidth: 420 }}>{(r.status === "Approved" && r.blockers?.[0]) || (r.reason || "").replace(/^\[[^\]]*\]\s*/, "").replace(/^Needs AP review:\s*/i, "") || r.blockers?.[0]}</td>
            </tr>
          ))}
          {!rows.length && <tr style={{ cursor: "default" }}><td colSpan={5} style={{ textAlign: "center", padding: 24, color: "#64748B" }}>Nothing blocked.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
