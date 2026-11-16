// Confirmation shown after "Create order": which order(s) were created,
// from which email, with a direct link to open each one.
import { useNavigate } from "react-router-dom";
import { ui } from "./styles";

const fmtLb = (n) => (Number(n) > 0 ? `${Number(n).toLocaleString()} lb` : "");

export default function CreatedBanner({ items, onDismiss, onShowCreated }) {
  const navigate = useNavigate();
  if (!items.length) return null;
  return (
    <div style={{ margin: "12px 0" }}>
      {items.map((c) => (
        <div key={c.intakeId} role="status" style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
            <div style={{ fontSize: 14, color: "#14532d" }}>
              <b>✓ {c.orders.length === 1 ? `Order ${c.orders[0].id} created` : `${c.orders.length} orders created`}</b>
              <span style={{ color: "#166534" }}> from “{c.subject || "(no subject)"}”{c.from ? ` · ${c.from}` : ""}</span>
            </div>
            <button style={{ ...ui.link, color: "#166534" }} onClick={() => onDismiss(c.intakeId)} aria-label="Dismiss">✕</button>
          </div>
          {c.orders.map((o) => (
            <div key={o.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8, fontSize: 13, color: "#14532d" }}>
              <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>{o.id}</span>
              <span>{[o.customer, o.po ? `PO ${o.po}` : "", o.lane, fmtLb(o.weight)].filter(Boolean).join(" · ")}</span>
              <span style={{ ...ui.chip("#dcfce7", "#166534") }}>Unplanned</span>
              <button style={{ ...ui.btn2, padding: "5px 12px" }} onClick={() => navigate(`/orders?id=${encodeURIComponent(o.id)}`)}>Open order</button>
            </div>
          ))}
          <div style={{ marginTop: 8 }}>
            <button style={{ ...ui.link, color: "#166534" }} onClick={onShowCreated}>See all created from email →</button>
          </div>
        </div>
      ))}
    </div>
  );
}
