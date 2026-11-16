// POD: what the agent read off the paper and which shipment it matched.
import { ui } from "../styles";

export default function PodFindings({ f }) {
  const p = f.pod || {};
  const refs = Object.entries(p.references || {}).filter(([, v]) => v).map(([k, v]) => `${k.replace("_", " ")}: ${v}`).join(" · ");
  return (
    <div>
      <div style={ui.grid}>
        {[["Document", p.doc_type], ["Matched shipment", f.shipment ? `${f.shipment.id} (${f.matchedOn})` : "no match"], ["Signed by", p.receiver_name || (p.signature_present ? "signature, no name" : "unsigned")], ["Delivered", [p.delivered_date, p.delivered_time].filter(Boolean).join(" ")], ["Pieces", p.pieces_delivered != null ? `${p.pieces_delivered}${f.shipment && f.shipment.pieces ? ` of ${f.shipment.pieces}` : ""}` : "—"], ["Confidence", `${Math.round((p.confidence || 0) * 100)}%`]].map(([k, v]) => (
          <div key={k} style={ui.kpi}><span style={ui.label}>{k}</span><div style={{ fontWeight: 700 }}>{v || "—"}</div></div>
        ))}
      </div>
      {refs && <div style={{ ...ui.muted, marginTop: 8 }}>References on the document: {refs}</div>}
      {(f.exceptions || []).length > 0 && <div style={ui.warn}>OS&D: {f.exceptions.map((e) => `${e.type}${e.pieces ? ` (${e.pieces} pc)` : ""} — ${e.detail}`).join(" · ")}</div>}
    </div>
  );
}
