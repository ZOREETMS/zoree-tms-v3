// Side panel: the immutable AP audit ledger for one invoice or export batch.
import { useEffect } from "react";
import { useApAuditHistory } from "../../hooks/useApAuditHistory";
import { EVENT_LABEL } from "../../services/apReleaseService";
import { Pill, dateTime } from "./intakeUi";

const TONE_OF = {
  exception_approved: "info", exception_disputed: "bad", revalidated: "none", released: "ok",
  release_blocked: "bad", override_released: "warn", exported: "ok", export_downloaded: "none", import_confirmed: "ok",
};

export default function ApAuditHistory({ invoiceId = null, batchId = null, title, onClose }) {
  const { events, loading, error } = useApAuditHistory({ invoiceId, batchId });

  useEffect(() => {
    const onKey = (ev) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.25)", zIndex: 899 }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(520px, 100vw)", background: "#fff", zIndex: 900, boxShadow: "-12px 0 32px rgba(15,23,42,.14)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #E8EDF3", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
            <div style={{ fontSize: 12, color: "#64748B" }}>Audit history · append-only — entries can't be edited or deleted</div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>✕ Close</button>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: 18 }}>
          {loading && <div style={{ color: "#94A3B8", fontSize: 13 }}>Loading…</div>}
          {error && <div style={{ color: "#B91C1C", fontSize: 13 }}>{error}</div>}
          {!loading && !error && !events.length && <div style={{ color: "#64748B", fontSize: 13 }}>No AP release or export activity yet.</div>}
          {events.map((e) => (
            <div key={e.id || `${e.at}-${e.type}`} style={{ padding: "10px 0", borderBottom: "1px solid #F1F5F9" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Pill tone={TONE_OF[e.type] || "none"}>{EVENT_LABEL[e.type] || e.type}</Pill>
                <span style={{ fontSize: 11.5, color: "#94A3B8", marginLeft: "auto" }}>{dateTime(e.at)}</span>
              </div>
              <div style={{ fontSize: 12.5, color: "#0F172A" }}>{e.detail}</div>
              <div style={{ fontSize: 11.5, color: "#64748B", marginTop: 2 }}>{e.actor}{e.role ? ` · ${e.role}` : ""}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
