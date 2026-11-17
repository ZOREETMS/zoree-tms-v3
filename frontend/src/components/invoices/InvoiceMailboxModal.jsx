// Read the AP mailbox. Opening this starts the check: Zoree AI reads the
// new carrier invoice emails for this domain, reads each PDF, matches the
// shipment and contract rate, and approves or holds each invoice.
import { useEffect, useRef } from "react";
import { useInvoiceMailbox } from "../../hooks/useInvoiceMailbox";
import { intakeSummary } from "../../services/invoiceIntakeService";
import IntakeResultRow from "./IntakeResultRow";
import { BRAND } from "../../config/brand";

export default function InvoiceMailboxModal({ onClose, onUseFolder }) {
  const { box, results, running, checked, error, start } = useInvoiceMailbox();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    start(); // one click: the check starts as the modal opens
  }, [start]);

  const changed = results.some((r) => r.status === "created");
  const close = () => { if (!running) onClose(changed); };
  const failed = error || (checked && box?.lastError);

  let line = "Checking the mailbox…";
  if (error) line = error;
  else if (checked && box?.lastError) line = `Mailbox check failed: ${box.lastError}`;
  else if (running) line = results.length ? `Reading invoice emails… ${results.length} done so far` : "Reading new emails…";
  else if (checked && results.length) line = intakeSummary(results);
  else if (checked) line = "No new carrier invoice emails since the last check. Earlier results are on the AP review tab.";

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" style={{ width: 760 }}>
        <div className="modal-header">
          <div className="modal-title">📬 AP mailbox</div>
          <button className="modal-close" onClick={close}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 10 }}>
            {BRAND.ai} reads new carrier invoice emails, reads each attached PDF, checks the read and the sender,
            matches the shipment and the contract rate, and runs the freight audit. Clean invoices go to AP.
            Everything else is held with the reason. Nothing is paid by the agent, and the mailbox is read-only.
          </div>
          {box && (
            <div className="mono" style={{ fontSize: 11, color: "var(--text3)", marginBottom: 10 }}>
              Mailbox {box.mailbox || "not configured"}
              {box.address ? ` · invoices for this domain are sent to ${box.address}` : " · no address set for this domain"}
            </div>
          )}
          <div style={{ margin: "8px 0 12px", fontSize: 13, fontWeight: 600, color: failed ? "var(--red)" : "var(--text)" }}>
            {line}
          </div>
          <div style={{ maxHeight: 420, overflow: "auto" }}>
            {results.map((r, i) => <IntakeResultRow key={r.intakeId || `${r.fileName}-${i}`} r={r} />)}
          </div>
        </div>
        <div className="modal-footer">
          {onUseFolder && (
            <button className="btn btn-secondary btn-sm" disabled={running} onClick={onUseFolder}
              title="Read the PDFs in this domain's inbox folder instead of the mailbox">
              Read inbox folder instead
            </button>
          )}
          {/* Once the read is finished, Close is the next step: make it the primary button. */}
          <button className={`btn btn-sm ${checked && !running ? "btn-primary" : "btn-secondary"}`} disabled={running} onClick={close}
            autoFocus={checked && !running} key={checked && !running ? "done" : "busy"}>
            {running ? "Reading…" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
