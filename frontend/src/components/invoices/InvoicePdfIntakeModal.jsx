import { useRef, useState } from "react";
import { uploadInvoicePdfs, intakeSummary, MAX_PDF_MB } from "../../services/invoiceIntakeService";
import IntakeResultRow from "./IntakeResultRow";

// Upload carrier invoice PDFs. Zoree AI reads each one, checks the read,
// creates the invoice and line-audits it. Clean ones go to AP; the rest
// are held with the reason.
export default function InvoicePdfIntakeModal({ onClose }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState([]);

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setBusy(true);
    setResults([]);
    setProgress({ done: 0, total: files.length });
    await uploadInvoicePdfs(files, (r, i) => {
      setResults((prev) => [...prev, r]);
      setProgress({ done: i + 1, total: files.length });
    });
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  const created = results.filter((r) => r.status === "created").length;

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && !busy && onClose(created > 0)}>
      <div className="modal" style={{ width: 760 }}>
        <div className="modal-header">
          <div className="modal-title">📄 Upload carrier invoice PDFs</div>
          <button className="modal-close" onClick={() => !busy && onClose(created > 0)}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 12 }}>
            Zoree AI reads each PDF, checks the read (lines add up, carrier on file, confidence), matches the shipment,
            and runs the freight audit. Clean invoices go to AP. Everything else is held with the reason.
            Nothing is paid by the agent. Max {MAX_PDF_MB} MB per file.
          </div>
          <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple disabled={busy}
            onChange={(e) => handleFiles(e.target.files)} />
          {progress.total > 0 && (
            <div style={{ margin: "12px 0", fontSize: 12, color: "var(--text3)" }}>
              {busy ? `Reading ${progress.done + 1} of ${progress.total}…` : intakeSummary(results)}
            </div>
          )}
          <div style={{ maxHeight: 420, overflow: "auto" }}>
            {results.map((r, i) => <IntakeResultRow key={`${r.fileName}-${i}`} r={r} />)}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onClose(created > 0)}>Close</button>
        </div>
      </div>
    </div>
  );
}
