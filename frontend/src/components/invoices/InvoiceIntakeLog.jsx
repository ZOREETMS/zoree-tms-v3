// AP review: every carrier invoice document received for this domain, grouped
// by what Zoree AI did with it, with a review drawer for each one.
import { useMemo, useState } from "react";
import ShipmentLink from "../shipments/ShipmentLink";
import { useInvoiceIntakeLog } from "../../hooks/useInvoiceIntakeLog";
import { INTAKE_OUTCOME, INTAKE_OUTCOME_ORDER, readyToPostRows } from "../../services/invoiceIntakeService";
import InvoiceIntakeDrawer from "./InvoiceIntakeDrawer";
import { TONE, Pill, ConfidenceBar, StatCard, money, pct } from "./intakeUi";

const SOURCE = { email: "AP mailbox", pdf_upload: "Upload" };

function Group({ code, rows, onOpen, openId }) {
  const meta = INTAKE_OUTCOME[code] || { label: code, tone: "none" };
  const t = TONE[meta.tone] || TONE.none;
  const total = rows.reduce((s, e) => s + (Number(e.total) || 0), 0);
  return (
    <div className="ap-card" style={{ marginBottom: 14, overflow: "hidden", borderLeft: `4px solid ${t.dot}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid #EEF2F7" }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: t.dot }} />
        <span style={{ fontWeight: 700, fontSize: 14 }}>{meta.label}</span>
        <span className="ap-count">{rows.length}</span>
        <span style={{ marginLeft: "auto", fontSize: 13, color: "#475569" }}>{money(total)}</span>
      </div>
      <table className="ap-table">
        <thead>
          <tr>
            <th>Invoice</th><th>Carrier</th><th>Shipment</th><th>Invoice date</th>
            <th style={{ textAlign: "right" }}>Total</th><th title="How sure the AI model says it is that it read the PDF correctly (its own estimate)">AI read confidence</th><th>Status</th><th>Audit result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.intakeId} onClick={() => onOpen(e.intakeId)} style={{ background: openId === e.intakeId ? "#F8FAFC" : undefined }} title="Open the review">
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 30, height: 34, borderRadius: 6, background: "#EEF2FF", color: "#4F46E5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700 }}>PDF</span>
                  <div>
                    <div style={{ fontWeight: 600 }}>{e.invoiceNumber || e.fileName}</div>
                    <div style={{ fontSize: 11.5, color: "#94A3B8" }} title="How this invoice came in">{e.fileName} · {e.arrival?.label || SOURCE[e.source] || e.source}</div>
                  </div>
                </div>
              </td>
              <td>{e.carrier || "—"}</td>
              <td>
                {e.shipmentInTms === false
                  ? <span className="mono" style={{ color: "#B91C1C" }} title="The carrier named a shipment that is not in the TMS">{e.shipmentRef} · not in TMS</span>
                  : <ShipmentLink id={e.shipmentRef} />}
              </td>
              <td style={{ color: "#475569" }}>{e.invoiceDate || "—"}</td>
              <td style={{ textAlign: "right", fontWeight: 600 }}>{money(e.total)}</td>
              <td><ConfidenceBar value={e.confidence} /></td>
              <td>
                <Pill tone={meta.tone}>{meta.label}</Pill>
              </td>
              <td style={{ fontSize: 12.5, color: meta.tone === "ok" ? "#047857" : meta.tone === "bad" || meta.tone === "warn" ? "#9A3412" : "#475569", maxWidth: 260 }}>
                {e.shortReason || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function InvoiceIntakeLog({ refreshKey, canDecide, onChanged, onGoToRelease }) {
  const { entries, summary, loading, error, reload } = useInvoiceIntakeLog(refreshKey);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState(null);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => (!filter || e.outcome === filter)
      && (!q || [e.fileName, e.invoiceNumber, e.carrier, e.shipmentRef].some((v) => String(v || "").toLowerCase().includes(q))));
  }, [entries, filter, search]);
  const groups = useMemo(() => INTAKE_OUTCOME_ORDER
    .map((code) => [code, shown.filter((e) => e.outcome === code)])
    .filter(([, rows]) => rows.length), [shown]);
  const ready = useMemo(() => readyToPostRows(entries), [entries]);

  if (loading) return <div style={{ padding: 20, color: "#94A3B8" }}>Loading…</div>;
  if (error) return <div className="ap-card" style={{ padding: 14, color: "#B91C1C", fontSize: 13 }}>{error}</div>;
  if (!entries.length) {
    return (
      <div className="ap-card" style={{ padding: 28, textAlign: "center", color: "#475569" }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No invoices received yet</div>
        <div style={{ fontSize: 13 }}>The agent reads each new carrier invoice email as it arrives in the AP mailbox. To check now, click <b>📬 Read AP Mailbox</b>.</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        {["needs_review", "ready_to_post", "duplicate", "disputed"].map((k) => (
          <StatCard key={k} label={INTAKE_OUTCOME[k].label} tone={INTAKE_OUTCOME[k].tone}
            value={summary?.[k]?.count ?? 0} sub={money(summary?.[k]?.total ?? 0)}
            active={filter === k} onClick={() => setFilter(filter === k ? "" : k)} />
        ))}
        <StatCard label="Avg. AI read confidence" value={pct(summary?.avgConfidence)} sub="model's own estimate" />
        <StatCard label="Total received" value={money(summary?.receivedTotal)} sub={`${summary?.received ?? entries.length} documents`}
          active={!filter} onClick={() => setFilter("")} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoices, carriers or shipments…"
          style={{ width: 340, maxWidth: "100%", height: 38, padding: "0 12px", border: "1px solid #E2E8F0", borderRadius: 10, fontSize: 13, background: "#fff" }} />
        {filter && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilter("")}>Clear filter ✕</button>}
        <button className="btn btn-secondary btn-sm" style={{ marginLeft: "auto" }} disabled={!onGoToRelease}
          onClick={onGoToRelease}
          title="NetSuite is read-only in the pilot: AP releases validated invoices and exports one NetSuite-ready CSV batch">
          Release &amp; export ({ready.length}) →
        </button>
      </div>

      {groups.map(([code, rows]) => <Group key={code} code={code} rows={rows} onOpen={setOpenId} openId={openId} />)}
      {!groups.length && <div style={{ padding: 16, color: "#94A3B8" }}>Nothing matches.</div>}
      <div style={{ fontSize: 12, color: "#94A3B8" }}>Click an invoice to review it. A person decides every exception; nothing is paid by the agent.</div>

      {openId && (
        <InvoiceIntakeDrawer intakeId={openId} canDecide={canDecide} onClose={() => setOpenId(null)}
          onChanged={() => { reload(); if (onChanged) onChanged(); }} />
      )}
    </div>
  );
}
