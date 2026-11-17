// NetSuite Import Preview — SIMULATION. Shows each export batch the way AP
// will see it before importing the CSV into NetSuite. It reads Zoree's own
// export records only: NetSuite is read-only in the pilot and is never
// called or written from here. "Mark imported" is AP's acknowledgement.
import { useState } from "react";
import { useApExports } from "../../hooks/useApExports";
import { confirmImport, downloadBatch } from "../../services/apReleaseService";
import ApAuditHistory from "./ApAuditHistory";
import { Pill, money, dateTime } from "./intakeUi";
import { BRAND } from "../../config/brand";

const STATUS = { exported: ["Exported", "info"], import_confirmed: ["Imported by AP", "ok"] };

function Batch({ b, canDecide, busy, onConfirm, onDownload, onHistory }) {
  const [label, tone] = STATUS[b.status] || [b.status, "none"];
  const [ref, setRef] = useState("");
  return (
    <div className="ap-card" style={{ marginBottom: 14, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid #EEF2F7" }}>
        <span className="mono" style={{ fontWeight: 700 }}>{b.id}</span>
        <Pill tone={tone}>{label}</Pill>
        <span style={{ fontSize: 12.5, color: "#64748B" }}>{b.createdBy} · {dateTime(b.createdAt)}{b.confirmedBy ? ` · imported per ${b.confirmedBy} ${dateTime(b.confirmedAt)}${b.importReference ? ` (ref ${b.importReference})` : ""}` : ""}{b.sha256 ? ` · SHA-256 ${b.sha256.slice(0, 12)}…` : ""}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onHistory}>History</button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={onDownload}>⬇ CSV</button>
          {canDecide && b.status === "exported" && (
            <>
              <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="NetSuite import ref (optional)"
                style={{ width: 190, height: 32, padding: "0 8px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: 12 }} />
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onConfirm(ref)} style={{ background: "#DCFCE7", color: "#166534" }}
                title="AP confirms they imported this file into NetSuite themselves">Mark imported by AP</button>
            </>
          )}
        </span>
      </div>
      <table className="ap-table">
        <thead>
          <tr><th>#</th><th>Invoice</th><th>Vendor</th><th>Shipment</th><th style={{ textAlign: "right" }}>Amount</th><th>External ID</th><th>Status</th></tr>
        </thead>
        <tbody>
          {b.items.map((i) => (
            <tr key={i.invoiceId} style={{ cursor: "default" }}>
              <td style={{ color: "#94A3B8" }}>{i.lineNo}</td>
              <td style={{ fontWeight: 600 }}>{i.invoiceNumber}</td>
              <td>{i.carrier}</td>
              <td className="mono" style={{ fontSize: 12.5 }}>{i.shipment || "—"}</td>
              <td style={{ textAlign: "right", fontWeight: 600 }}>{money(i.amount)}</td>
              <td className="mono" style={{ fontSize: 11.5, color: "#475569" }}>{i.externalId}</td>
              <td><Pill tone={tone}>{label}</Pill></td>
            </tr>
          ))}
          <tr style={{ cursor: "default", background: "#F8FAFC" }}>
            <td /><td style={{ fontWeight: 700 }}>Total</td><td /><td />
            <td style={{ textAlign: "right", fontWeight: 700 }}>{money(b.total)}</td>
            <td colSpan={2} style={{ fontSize: 12, color: "#64748B" }}>{b.invoiceCount} vendor bill(s)</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function NetSuiteImportPreview({ refreshKey, canDecide }) {
  const { batches, missingConfig, loading, error, reload } = useApExports(refreshKey);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [history, setHistory] = useState(null);

  async function run(fn) {
    setBusy(true); setMsg("");
    try { setMsg(await fn()); await reload(); } catch (e) { setMsg(e?.message || "Something went wrong"); } finally { setBusy(false); }
  }

  if (loading) return <div style={{ padding: 20, color: "#94A3B8" }}>Loading…</div>;
  if (error) return <div className="ap-card" style={{ padding: 14, color: "#B91C1C", fontSize: 13 }}>{error}</div>;

  return (
    <div>
      <div className="ap-card" style={{ padding: "14px 16px", marginBottom: 14, borderLeft: "4px solid #F59E0B" }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>NetSuite Import Preview — Simulation</div>
        <div style={{ fontSize: 12.5, color: "#475569", marginTop: 4 }}>
          What AP will import from each {BRAND.short} export file. This is not NetSuite and nothing here is posted to NetSuite —
          NetSuite stays read-only for the pilot and AP performs the import. After the pilot, subject to IT approval, the same
          batches could create vendor bills through a controlled NetSuite API with duplicate safeguards and audit logging.
        </div>
        {missingConfig.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12.5, color: "#92400E" }}>
            <b>Configuration still needed before a real import:</b> {missingConfig.join("; ")}. These columns read CONFIG_NEEDED in the CSV.
          </div>
        )}
      </div>
      {msg && <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: "#F0FDF4", color: "#166534", fontSize: 13 }}>{msg}</div>}
      {batches.map((b) => (
        <Batch key={b.id} b={b} canDecide={canDecide} busy={busy}
          onHistory={() => setHistory(b.id)}
          onDownload={() => run(async () => { await downloadBatch(b); return `${b.fileName} downloaded again — same batch, not a new export.`; })}
          onConfirm={(ref) => run(async () => { await confirmImport(b.id, ref); return `${b.id} marked as imported by AP. ${BRAND.short} did not write to NetSuite.`; })} />
      ))}
      {!batches.length && (
        <div className="ap-card" style={{ padding: 28, textAlign: "center", color: "#64748B", fontSize: 13 }}>
          No export batches yet. Release validated invoices under <b>Release &amp; export</b>, then export them.
        </div>
      )}
      {history && <ApAuditHistory batchId={history} title={history} onClose={() => setHistory(null)} />}
    </div>
  );
}
