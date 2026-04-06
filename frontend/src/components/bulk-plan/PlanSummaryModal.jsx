import { useNavigate } from "react-router-dom";

/**
 * Post-plan summary modal — matches old HTML modal-plan-summary.
 * Shows KPIs, shipment cards with consolidated order details.
 */
function formatElapsed(ms) {
  if (!ms) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function PlanSummaryModal({ isOpen, shipments, ordersUpdated, elapsedMs, onClose }) {
  const navigate = useNavigate();

  if (!isOpen || !shipments?.length) return null;

  const totalCost = shipments.reduce((s, sh) => s + (parseFloat(sh.total_cost) || 0), 0);
  const totalWeight = shipments.reduce((s, sh) => s + (parseInt(sh.weight) || 0), 0);

  function handleViewShipments() {
    const ids = shipments.map((s) => s.id).join(",");
    onClose();
    navigate(`/shipments?ids=${encodeURIComponent(ids)}`);
  }

  return (
    <div className="modal-overlay open">
      <div className="modal" style={{ width: 620 }}>
        {/* Header */}
        <div
          className="modal-header"
          style={{ background: "linear-gradient(135deg,#0f4c35,#16a34a)" }}
        >
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,.6)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
              Planning Complete{formatElapsed(elapsedMs) ? ` \u00b7 ${formatElapsed(elapsedMs)}` : ""}
            </div>
            <span className="modal-title" style={{ color: "#fff" }}>
              {shipments.length} Shipment{shipments.length !== 1 ? "s" : ""} Created Successfully
            </span>
          </div>
          <button className="modal-close" onClick={onClose} style={{ color: "rgba(255,255,255,.7)", fontSize: 22 }}>
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="modal-body" style={{ padding: 20 }}>
          {/* KPI Strip */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 18 }}>
            <KpiCard value={shipments.length} label="Shipments" color="var(--green)" bg="rgba(16,185,129,.08)" border="rgba(16,185,129,.2)" onClick={handleViewShipments} />
            <KpiCard value={ordersUpdated || shipments.length} label="Orders Planned" color="var(--accent)" bg="rgba(59,130,246,.07)" border="rgba(59,130,246,.2)" />
            <KpiCard value={`$${totalCost.toLocaleString()}`} label="Total Est. Cost" color="var(--green)" bg="rgba(16,185,129,.08)" border="rgba(16,185,129,.2)" />
          </div>

          {/* Shipment Cards */}
          {shipments.map((sh) => (
            <ShipmentCard key={sh.id} shipment={sh} />
          ))}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={handleViewShipments}>📦 View Shipments</button>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ value, label, color, bg, border, onClick, style: extraStyle }) {
  return (
    <div
      style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: 12, textAlign: "center", cursor: onClick ? "pointer" : "default", ...extraStyle }}
      onClick={onClick}
      title={onClick ? "Click to view" : ""}
    >
      <div style={{ fontSize: 22, fontWeight: 800, color, textDecoration: onClick ? "underline" : "none", textUnderlineOffset: 4 }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function ShipmentCard({ shipment: sh }) {
  const weight = parseInt(sh.weight) || 0;
  const util = Math.round((weight / 44000) * 100);
  const utilCol = util >= 90 ? "var(--green)" : util >= 70 ? "var(--yellow)" : "var(--accent)";
  const origin = (sh.origin || "").split(",")[0];
  const dest = (sh.destination || sh.dest || "").split(",")[0];

  return (
    <div
      style={{
        background: "#fff",
        border: "1.5px solid var(--border)",
        borderRadius: 12,
        padding: "14px 16px",
        marginBottom: 10,
        transition: "all .15s",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div
          style={{
            width: 32, height: 32, borderRadius: 8,
            background: "linear-gradient(135deg,var(--accent),#7c3aed)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
          }}
        >
          🚛
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: "var(--accent)" }}>{sh.id}</div>
          <div style={{ fontSize: 11, color: "var(--text3)" }}>{sh.carrier} · {sh.mode || sh.transport_mode || "TL"}</div>
        </div>
        <span
          style={{
            background: "rgba(16,185,129,.1)", color: "var(--green)",
            border: "1px solid rgba(16,185,129,.25)", fontSize: 11,
            fontWeight: 700, padding: "3px 10px", borderRadius: 20,
          }}
        >
          ✓ Planned
        </span>
      </div>

      {/* Lane */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: "var(--text3)" }}>📍</span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{origin}</span>
        <span style={{ color: "var(--text3)", fontSize: 12 }}>→</span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{dest}</span>
        <span className="mono" style={{ marginLeft: "auto", fontWeight: 800, color: "var(--green)", fontSize: 14 }}>
          ${(parseFloat(sh.total_cost) || 0).toLocaleString()}
        </span>
      </div>

      {/* Weight / Pickup / Delivery footer */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <FooterCell label="Weight" value={`${weight.toLocaleString()} lbs`} color={utilCol} />
        <FooterCell label="Pickup" value={sh.pickup_date || sh.pickup || "—"} />
        <FooterCell label="Delivery" value={sh.delivery_date || sh.delivery || "—"} />
      </div>
    </div>
  );
}

function FooterCell({ label, value, color }) {
  return (
    <div style={{ background: "#f8faff", borderRadius: 7, padding: 7, textAlign: "center" }}>
      <div style={{ fontSize: 10, color: "var(--text3)" }}>{label}</div>
      <div className="mono" style={{ fontWeight: 700, fontSize: 12, color: color || "var(--text)" }}>{value}</div>
    </div>
  );
}
