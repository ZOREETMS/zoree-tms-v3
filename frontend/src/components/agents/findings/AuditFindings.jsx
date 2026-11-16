// Freight audit: AP policy in force, each invoice billed vs rated with the
// issues found, who has to act, and the NetSuite ready-to-post list.
import { ui } from "../styles";
import { money } from "../../../services/agentsService";

const VERDICT = {
  dispute: ["#fee2e2", "#991b1b", "Dispute · to a person"],
  approve: ["#dcfce7", "#166534", "Approve"],
  review: ["#e0f2fe", "#075985", "Over limit · to a person"],
  hold: ["#fef3c7", "#92400e", "Hold · to a person"],
  needs_data: ["#fef3c7", "#92400e", "Hold for BOL/POD · to a person"],
};

function PolicyBar({ p }) {
  if (!p) return null;
  const items = [
    p.shadowMode ? "Shadow mode: change freeze, the agent suggests and people do the work" : "Live: clean invoices under the limit can be approved by the agent",
    `Auto-approve limit ${money(p.approvalLimitUsd)}`,
    p.erpReadOnly ? "NetSuite read-only: AP posts from the list below" : "NetSuite posting enabled",
  ];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "4px 0 10px" }}>
      {items.map((t) => <span key={t} style={ui.chip(p.shadowMode && t.startsWith("Shadow") ? "#fef3c7" : "#f1f5f9", p.shadowMode && t.startsWith("Shadow") ? "#92400e" : "#334155")}>{t}</span>)}
    </div>
  );
}

function ReadyToPost({ rows }) {
  if (!rows || !rows.length) return null;
  const total = rows.reduce((s, r) => s + Number(r.payAmount || 0), 0);
  return (
    <div style={{ borderTop: "1px solid #e2e8f0", marginTop: 8, paddingTop: 10 }}>
      <div style={ui.row}>
        <div><b>NetSuite ready-to-post list</b> <span style={ui.muted}>· {rows.length} invoice(s) · {money(total)}</span></div>
        <span style={ui.muted}>Release and export from Freight Invoices → Release &amp; export (each invoice is exported once)</span>
      </div>
      <table style={{ ...ui.table, maxWidth: 760 }}>
        <thead><tr><th style={ui.td}>Invoice</th><th style={ui.td}>Carrier</th><th style={ui.td}>Shipment</th><th style={{ ...ui.td, textAlign: "right" }}>Pay</th><th style={ui.td}>Basis</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.invoiceId}><td style={ui.td}>{r.number}</td><td style={ui.td}>{r.carrier}</td><td style={ui.td}>{(r.shipments || []).join(", ")}</td><td style={{ ...ui.td, textAlign: "right" }}>{money(r.payAmount)}</td><td style={ui.td}>{r.basis}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export default function AuditFindings({ f }) {
  const counts = f.counts || {};
  return (
    <div>
      <PolicyBar p={f.policy} />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        {counts.total ? <div style={ui.kpi}><span style={ui.label}>Audited</span><div style={ui.kpiNum}>{counts.total}</div></div> : null}
        {counts.total ? <div style={ui.kpi}><span style={ui.label}>Clean</span><div style={{ ...ui.kpiNum, color: "#166534" }}>{counts.clean}</div></div> : null}
        {counts.total ? <div style={ui.kpi}><span style={ui.label}>To a person</span><div style={{ ...ui.kpiNum, color: "#92400e" }}>{counts.toPerson}</div></div> : null}
        <div style={ui.kpi}><span style={ui.label}>Not payable as billed</span><div style={{ ...ui.kpiNum, color: "#16a34a" }}>{money(f.recoverable)}</div></div>
      </div>
      {(f.invoices || []).map((inv) => {
        const [bg, fg, label] = VERDICT[inv.verdict] || VERDICT.needs_data;
        return (
          <div key={inv.id} style={{ borderTop: "1px solid #f1f5f9", padding: "10px 0" }}>
            <div style={ui.row}>
              <div><b>{inv.number || inv.id}</b> · {inv.carrier} · billed {money(inv.billed)} vs rated {money(inv.rated)} <span style={ui.muted}>({inv.status})</span></div>
              <div><span style={ui.chip(bg, fg)}>{label}</span>{inv.recoverable ? <span style={{ ...ui.chip("#dcfce7", "#166534"), marginLeft: 6 }}>recover {money(inv.recoverable)}</span> : null}</div>
            </div>
            {inv.issues.length > 0 && <ul style={{ margin: "6px 0 0 18px", fontSize: 13, color: "#334155" }}>{inv.issues.map((i, k) => <li key={k}>{i.detail}</li>)}</ul>}
            {inv.issues.length === 0 && (inv.passed || []).length > 0 && <div style={{ ...ui.muted, marginTop: 4 }}>Checks passed: {inv.passed.join(" · ")}</div>}
            {inv.lines.length > 0 && (
              <table style={{ ...ui.table, maxWidth: 560 }}>
                <tbody>{inv.lines.map((l, k) => <tr key={k}><td style={ui.td}>{l.type}</td><td style={ui.td}>{l.description}</td><td style={{ ...ui.td, textAlign: "right" }}>{money(l.amount)}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        );
      })}
      <ReadyToPost rows={f.readyToPost} />
    </div>
  );
}
