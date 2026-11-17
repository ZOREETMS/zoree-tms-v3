// Read the AP inbox folder. Opening this starts the run: Zoree AI reads
// every new PDF in the domain's inbox, checks the read, matches the
// shipment and contract rate, and approves or holds each invoice.
import { useEffect, useRef } from "react";
import { useInvoiceInbox } from "../../hooks/useInvoiceInbox";
import { inboxRunSummary } from "../../services/invoiceIntakeService";
import IntakeResultRow from "./IntakeResultRow";
import { BRAND } from "../../config/brand";

export default function InvoiceInboxModal({ onClose }) {
  const { inbox, job, running, error, refresh, start } = useInvoiceInbox();
  const started = useRef(false);

  // One click: load the folder, then start if anything new is waiting.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const data = await refresh();
      if (data && data.waiting > 0 && !(data.job && data.job.status === "running")) start();
    })();
  }, [refresh, start]);

  const results = job?.results || [];
  const changed = results.some((r) => r.status === "created");
  const close = () => { if (!running) onClose(changed); };
  const reading = job ? Math.min(results.length + 1, job.total) : 0;

  let line = "Looking in the inbox…";
  if (error) line = error;
  else if (inbox && !inbox.exists) line = "This domain has no inbox folder yet.";
  else if (running) line = job.total ? `Reading ${reading} of ${job.total}${job.current ? ` · ${job.current}` : ""}…` : "Reading the inbox…";
  else if (job && job.status === "failed") line = `Run stopped: ${job.error}`;
  else if (job && results.length) line = inboxRunSummary(job);
  else if (inbox) line = inbox.files.length ? `Nothing new — all ${inbox.alreadyRead} PDFs in the inbox were already read.` : "The inbox is empty.";

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" style={{ width: 760 }}>
        <div className="modal-header">
          <div className="modal-title">📬 AP inbox</div>
          <button className="modal-close" onClick={close}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 10 }}>
            {BRAND.ai} reads each new carrier invoice PDF in the inbox, checks the read, matches the shipment and the
            contract rate, and runs the freight audit. Clean invoices go to AP. Everything else is held with the reason.
            Nothing is paid by the agent.
          </div>
          {inbox && (
            <div className="mono" style={{ fontSize: 11, color: "var(--text3)", marginBottom: 10 }}>
              {inbox.folder} · {inbox.files.length} PDFs · {inbox.alreadyRead} already read
            </div>
          )}
          <div style={{ margin: "8px 0 12px", fontSize: 13, fontWeight: 600, color: error || job?.status === "failed" ? "var(--red)" : "var(--text)" }}>
            {line}
          </div>
          {running && job.total > 0 && (
            <div style={{ height: 4, background: "var(--border)", borderRadius: 4, marginBottom: 12, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(results.length / job.total) * 100}%`, background: "var(--accent)", transition: "width .3s" }} />
            </div>
          )}
          <div style={{ maxHeight: 420, overflow: "auto" }}>
            {results.map((r, i) => <IntakeResultRow key={`${r.fileName}-${i}`} r={r} />)}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary btn-sm" disabled={running} onClick={close}>Close</button>
        </div>
      </div>
    </div>
  );
}
