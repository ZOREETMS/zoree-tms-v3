// Release & export: the agent recommends, a person releases, AP imports.
// Validated invoices are released (one by one or in a batch), released
// invoices go out as one NetSuite-ready CSV batch, exceptions stay blocked.
// NetSuite is read-only during the pilot — nothing here writes to it.
import { useState } from "react";
import { useApReleaseQueue } from "../../hooks/useApReleaseQueue";
import {
  releaseInvoice, releaseInvoices, exportReleased, downloadBatch, releaseSummary,
} from "../../services/apReleaseService";
import { AwaitingReleaseTable, ReleasedTable, BlockedTable } from "./releaseTables";
import ApAuditHistory from "./ApAuditHistory";
import { StatCard, Pill, money, dateTime } from "./intakeUi";

export default function ReleaseQueue({ refreshKey, canDecide, onChanged, onOpenPreview }) {
  const { queue, loading, error, reload } = useApReleaseQueue(refreshKey);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { tone, text }
  const [history, setHistory] = useState(null); // { invoiceId?, batchId?, title }

  async function run(fn) {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ tone: "ok", text });
      await reload();
      if (onChanged) onChanged();
      return true;
    } catch (e) {
      setMsg({ tone: "bad", text: e?.message || "Something went wrong" });
      await reload();
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div style={{ padding: 20, color: "#94A3B8" }}>Loading…</div>;
  if (error) return <div className="ap-card" style={{ padding: 14, color: "#B91C1C", fontSize: 13 }}>{error}</div>;
  const q = queue;
  const label = (id) => [...q.awaitingRelease, ...q.released].find((r) => r.invoiceId === id)?.invoiceNumber || id;

  return (
    <div>
      <div className="ap-card" style={{ padding: "12px 16px", marginBottom: 14, display: "flex", gap: 10, alignItems: "center", background: "#F8FAFC" }}>
        <Pill tone="info">NetSuite read-only pilot</Pill>
        <span style={{ fontSize: 12.5, color: "#334155" }}>
          The agent validates and recommends. A person releases each invoice. Zoree generates a NetSuite-ready CSV and AP imports it —
          the agent cannot create bills, write to NetSuite, or move money.
        </span>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <StatCard label="Ready to release" tone="ok" value={q.awaitingRelease.length} sub={money(q.totals.awaitingRelease)} />
        <StatCard label="Released — next export" tone="info" value={q.released.length} sub={money(q.totals.released)} />
        <StatCard label="Exported to CSV" value={q.exported.length} sub={money(q.totals.exported)} onClick={onOpenPreview} />
        <StatCard label="Blocked (needs a person)" tone="bad" value={q.blocked.length} sub="exceptions and holds" />
      </div>

      {msg && (
        <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 10, fontSize: 13,
          background: msg.tone === "ok" ? "#F0FDF4" : "#FEF2F2", color: msg.tone === "ok" ? "#166534" : "#B91C1C" }}>{msg.text}</div>
      )}

      <AwaitingReleaseTable rows={q.awaitingRelease} total={q.totals.awaitingRelease} canDecide={canDecide} busy={busy}
        onHistory={(r) => setHistory({ invoiceId: r.invoiceId, title: `${r.invoiceNumber} · ${r.carrier}` })}
        onRelease={(id, note) => run(async () => { const r = await releaseInvoice(id, { note }); return `${label(id)} released for export (${r.path.replace(/_/g, " ")}).`; })}
        onReleaseMany={(ids, note) => run(async () => releaseSummary(await releaseInvoices(ids, note)))} />

      <ReleasedTable rows={q.released} total={q.totals.released} canDecide={canDecide} busy={busy}
        onHistory={(r) => setHistory({ invoiceId: r.invoiceId, title: `${r.invoiceNumber} · ${r.carrier}` })}
        onExport={(ids) => run(async () => {
          const out = await exportReleased(ids);
          const skipped = out.skipped?.length ? ` Skipped: ${out.skipped.map((s) => `${s.invoiceId} (${s.reason})`).join(", ")}.` : "";
          const config = out.missingConfig?.length ? ` NetSuite settings still needed: ${out.missingConfig.join("; ")}.` : "";
          return `Batch ${out.batch.id}: ${out.count} invoice(s), ${money(out.total)} — ${out.fileName} downloaded for AP to import.${skipped}${config}`;
        })} />

      <BlockedTable rows={q.blocked} onHistory={(r) => setHistory({ invoiceId: r.invoiceId, title: `${r.invoiceNumber} · ${r.carrier}` })} />

      {q.batches.length > 0 && (
        <div className="ap-card" style={{ padding: "14px 16px" }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Export batches</div>
          {q.batches.map((b) => (
            <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid #F1F5F9", fontSize: 12.5 }}>
              <span className="mono" style={{ fontWeight: 600 }}>{b.id}</span>
              <Pill tone={b.status === "import_confirmed" ? "ok" : "info"}>{b.status === "import_confirmed" ? "Import confirmed" : "Exported"}</Pill>
              <span>{b.invoiceCount} invoice(s) · {money(b.total)}</span>
              <span style={{ color: "#94A3B8" }}>{b.createdBy} · {dateTime(b.createdAt)}</span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHistory({ batchId: b.id, title: b.id })}>History</button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy}
                  onClick={() => run(async () => { await downloadBatch(b); return `${b.fileName} downloaded again — same batch, not a new export.`; })}>⬇ CSV</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {history && <ApAuditHistory invoiceId={history.invoiceId} batchId={history.batchId} title={history.title} onClose={() => setHistory(null)} />}
    </div>
  );
}
