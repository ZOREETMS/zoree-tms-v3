import { useMemo } from "react";

const REJECTION_REASONS = [
  "No capacity available on this lane",
  "Equipment not available for pickup date",
  "Rate below minimum acceptable rate",
  "Driver HOS restrictions",
  "Weight/dimensions exceed equipment limit",
  "Hazmat certification required",
  "Lane outside service area",
  "Other",
];

export { REJECTION_REASONS };

function getUrgency(pickupDate) {
  const days = Math.ceil((new Date(pickupDate) - new Date()) / 86400000);
  if (days <= 0) return { color: "var(--red)", label: "TODAY" };
  if (days === 1) return { color: "var(--red)", label: "TOMORROW" };
  if (days <= 3) return { color: "var(--yellow)", label: `in ${days} days` };
  return { color: "var(--green)", label: `in ${days} days` };
}

function getStatusDisplay(response) {
  if (!response) {
    return {
      badge: { bg: "rgba(245,158,11,.15)", color: "#d97706", border: "rgba(245,158,11,.3)", label: "AWAITING RESPONSE", icon: "" },
      borderColor: "var(--border)",
      headerBg: "linear-gradient(135deg,#1e2d6b,#2d4a8a)",
    };
  }
  if (response.action === "accept") {
    return {
      badge: { bg: "rgba(16,185,129,.15)", color: "#059669", border: "rgba(16,185,129,.3)", label: "ACCEPTED", icon: "" },
      borderColor: "rgba(16,185,129,.4)",
      headerBg: "linear-gradient(135deg,#0f4c35,#16a34a)",
    };
  }
  return {
    badge: { bg: "rgba(239,68,68,.15)", color: "#dc2626", border: "rgba(239,68,68,.3)", label: "REJECTED", icon: "" },
    borderColor: "rgba(239,68,68,.3)",
    headerBg: "linear-gradient(135deg,#7f1d1d,#dc2626)",
  };
}

function InfoCell({ label, value, icon }) {
  return (
    <div style={{ background: "#f8faff", borderRadius: 8, padding: "8px 10px", border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 3 }}>{icon} {label}</div>
      <div style={{ fontWeight: 600, fontSize: 12, color: "var(--text)" }}>{value}</div>
    </div>
  );
}

export default function TenderCard({ shipment, response, consolidatedOrders, onAccept, onReject, onViewDetail, onChangeResponse }) {
  const isPending = !response;
  const urgency = useMemo(() => getUrgency(shipment.pickup), [shipment.pickup]);
  const status = useMemo(() => getStatusDisplay(response), [response]);
  const relOrders = consolidatedOrders || 0;

  return (
    <div style={{
      background: "#fff", borderRadius: 14, border: `2px solid ${status.borderColor}`,
      overflow: "hidden", boxShadow: "0 2px 12px rgba(30,45,107,.08)", transition: "box-shadow .2s",
    }}>
      {/* Card Header */}
      <div style={{
        background: status.headerBg, padding: "14px 18px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 800, color: "#fff" }}>{shipment.id}</div>
          <span style={{
            fontSize: 10, fontWeight: 700,
            background: status.badge.bg, color: status.badge.color,
            border: `1px solid ${status.badge.border}`,
            padding: "3px 9px", borderRadius: 20,
          }}>
            {status.badge.icon} {status.badge.label}
          </span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,.85)" }}>{shipment.carrier}</div>
      </div>

      {/* Lane + Pickup Urgency */}
      <div style={{
        padding: "14px 18px", borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
            {(shipment.origin || "").split(",")[0]} &rarr; {(shipment.dest || "").split(",")[0]}
          </div>
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
            {shipment.origin} &rarr; {shipment.dest}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".6px" }}>Pickup</div>
          <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "monospace", marginTop: 1 }}>{shipment.pickup}</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: urgency.color, marginTop: 2 }}>{urgency.label}</div>
        </div>
      </div>

      {/* Details Grid */}
      <div style={{
        padding: "14px 18px",
        display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10,
        borderBottom: "1px solid var(--border)",
      }}>
        <InfoCell label="Mode" value={shipment.mode} icon="" />
        <InfoCell label="Weight" value={`${Number(shipment.weight || 0).toLocaleString()} lbs`} icon="" />
        <InfoCell label="Pieces" value={String(shipment.pieces || 0)} icon="" />
        <InfoCell label="Commodity" value={shipment.commodity || "General"} icon="" />
        <InfoCell label="Delivery" value={shipment.delivery} icon="" />
        <InfoCell label="Est. Rate" value={shipment.cost || shipment.total_cost || "N/A"} icon="" />
      </div>

      {/* Consolidated orders info */}
      {relOrders > 1 && (
        <div style={{
          padding: "10px 18px", background: "rgba(99,102,241,.05)",
          borderBottom: "1px solid var(--border)", fontSize: 12,
          color: "#6366f1", fontWeight: 600,
        }}>
          Consolidated shipment - {relOrders} orders
        </div>
      )}

      {/* Response Details */}
      {response && (
        <div style={{
          padding: "12px 18px",
          background: response.action === "accept" ? "rgba(16,185,129,.05)" : "rgba(239,68,68,.04)",
          borderBottom: "1px solid var(--border)",
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 8 }}>
            Response Details
          </div>
          {response.action === "accept" ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 12 }}>
              {response.driver && <div><span style={{ color: "var(--text3)" }}>Driver: </span><strong>{response.driver}</strong></div>}
              {response.phone && <div><span style={{ color: "var(--text3)" }}>Phone: </span><strong>{response.phone}</strong></div>}
              {response.truck && <div><span style={{ color: "var(--text3)" }}>Unit #: </span><strong>{response.truck}</strong></div>}
              {response.pickupEta && <div><span style={{ color: "var(--text3)" }}>ETA: </span><strong>{response.pickupEta.replace("T", " ")}</strong></div>}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--red)", fontWeight: 600 }}>{response.reason}</div>
          )}
          {response.notes && (
            <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4, fontStyle: "italic" }}>"{response.notes}"</div>
          )}
          <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 6 }}>Responded: {response.respondedAt}</div>
        </div>
      )}

      {/* Action Buttons */}
      <div style={{ padding: "12px 18px", display: "flex", gap: 8 }}>
        <button
          onClick={() => onViewDetail(shipment.id)}
          style={{
            flex: 1, padding: 8, background: "#f0f4ff", border: "1px solid var(--border2)",
            borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
            color: "var(--accent)", fontFamily: "inherit",
          }}
        >
          View Details
        </button>
        {isPending ? (
          <>
            <button
              onClick={() => onAccept(shipment.id)}
              style={{
                flex: 1, padding: 8, background: "rgba(16,185,129,.1)", border: "1.5px solid var(--green)",
                borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
                color: "var(--green)", fontFamily: "inherit",
              }}
            >
              Accept
            </button>
            <button
              onClick={() => onReject(shipment.id)}
              style={{
                flex: 1, padding: 8, background: "rgba(239,68,68,.08)", border: "1.5px solid var(--red)",
                borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
                color: "var(--red)", fontFamily: "inherit",
              }}
            >
              Reject
            </button>
          </>
        ) : (
          <button
            onClick={() => onChangeResponse(shipment.id)}
            style={{
              flex: 1, padding: 8, background: "#f8faff", border: "1px solid var(--border)",
              borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
              color: "var(--text2)", fontFamily: "inherit",
            }}
          >
            Change Response
          </button>
        )}
      </div>
    </div>
  );
}
