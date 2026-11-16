// Freight audit input: one invoice, or scan Rejected / On Hold invoices.
import { useState } from "react";
import { ui } from "../styles";
import { DEMO_IDS } from "../../../constants/agentDemo";

export default function AuditForm({ onRun, busy }) {
  const [invoiceId, setInvoiceId] = useState("");
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
      <button style={{ ...ui.btn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => onRun({ scan: true, limit: 8 })}>
        {busy ? "Auditing…" : "Audit rejected & on-hold invoices"}
      </button>
      <span style={ui.muted}>or one invoice:</span>
      <div style={{ width: 200 }}><span style={ui.label}>Invoice</span><input style={ui.input()} value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} placeholder="INV-…" /></div>
      <button style={ui.link} onClick={() => setInvoiceId(DEMO_IDS.auditInvoice)}>Use demo invoice</button>
      <button style={ui.btn2} disabled={busy || !invoiceId} onClick={() => onRun({ invoiceId })}>Audit</button>
    </div>
  );
}
