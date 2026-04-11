import { plannedDeliveryDate, plannedPickupDate, resolveCarrierName } from "../../utils/carrierPortal";

function InfoCell({ label, value, icon }) {
  return (
    <div style={{ background: "#f8faff", borderRadius: 8, padding: "8px 10px", border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 3 }}>{icon} {label}</div>
      <div style={{ fontWeight: 600, fontSize: 12, color: "var(--text)" }}>{value}</div>
    </div>
  );
}

export default function TenderDetailModal({ shipment, response, relatedOrders, onClose, onRespond }) {
  if (!shipment) return null;

  const isAccepted = response?.action === "accept";
  const isRejected = response?.action === "reject";
  const hasHazmat = (relatedOrders || []).some((o) => o.hazmat);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ width: 560 }}>
        {/* Header */}
        <div className="modal-header" style={{ background: "linear-gradient(135deg,#0f172a,#1e3a5f)" }}>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,.6)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>
              Tender Details
            </div>
            <h3 style={{ color: "#fff", margin: 0 }}>{shipment.id} — {resolveCarrierName(shipment)}</h3>
          </div>
          <button className="modal-close" onClick={onClose} style={{ color: "rgba(255,255,255,.7)" }}>&#10005;</button>
        </div>

        <div style={{ padding: 0 }}>
          {/* Lane Banner */}
          <div style={{
            padding: "18px 20px",
            background: "linear-gradient(135deg,rgba(30,45,107,.04),rgba(59,130,246,.06))",
            borderBottom: "1px solid var(--border)",
          }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", marginBottom: 4 }}>
              {shipment.origin} &rarr; {shipment.dest}
            </div>
            <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text2)" }}>
              <span>{shipment.mode}</span>
              <span>{Number(shipment.weight || 0).toLocaleString()} lbs</span>
              <span>{shipment.pieces} pieces</span>
              <span>{shipment.commodity}</span>
            </div>
          </div>

          {/* Dates + Rate */}
          <div style={{
            padding: "16px 20px",
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12,
            borderBottom: "1px solid var(--border)",
          }}>
            <InfoCell label="Planned Pickup Date" value={plannedPickupDate(shipment)} icon="" />
            <InfoCell label="Planned Delivery Date" value={plannedDeliveryDate(shipment)} icon="" />
            <InfoCell label="Agreed Rate" value={shipment.cost || shipment.total_cost || "N/A"} icon="" />
          </div>

          {/* Related Orders */}
          {relatedOrders && relatedOrders.length > 0 && (
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 10 }}>
                Orders in this Shipment ({relatedOrders.length})
              </div>
              {relatedOrders.map((o) => (
                <div key={o.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px", background: "#f8faff", borderRadius: 8,
                  marginBottom: 6, border: "1px solid var(--border)", fontSize: 12,
                }}>
                  <span style={{ color: "var(--accent)", fontFamily: "monospace", fontWeight: 600 }}>{o.id}</span>
                  <span style={{ color: "var(--text2)" }}>{o.customer}</span>
                  <span style={{ color: "var(--text3)" }}>- {o.commodity}</span>
                  <span style={{ marginLeft: "auto", fontFamily: "monospace", color: "var(--text2)" }}>
                    {Number(o.weight || 0).toLocaleString()} lbs
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Hazmat Warning */}
          {hasHazmat && (
            <div style={{
              padding: "12px 20px",
              background: "rgba(239,68,68,.06)",
              borderBottom: "1px solid rgba(239,68,68,.2)",
              borderLeft: "3px solid var(--red)",
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--red)" }}>
                HAZMAT — Special handling required. Ensure proper placards and certifications.
              </div>
            </div>
          )}

          {/* Response Status */}
          {response && (
            <div style={{
              padding: "16px 20px",
              background: isAccepted ? "rgba(16,185,129,.05)" : "rgba(239,68,68,.04)",
            }}>
              <div style={{
                fontSize: 11, fontWeight: 700,
                color: isAccepted ? "var(--green)" : "var(--red)",
                textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 10,
              }}>
                {isAccepted ? "Tender Accepted" : "Tender Rejected"}
              </div>
              {isAccepted ? (
                <>
                  {response.driver && (
                    <div style={{ fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: "var(--text3)" }}>Driver: </span>
                      <strong>{response.driver}{response.phone ? ` - ${response.phone}` : ""}</strong>
                    </div>
                  )}
                  {response.truck && (
                    <div style={{ fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: "var(--text3)" }}>Unit #: </span>
                      <strong>{response.truck}</strong>
                    </div>
                  )}
                  {response.proNumber && (
                    <div style={{ fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: "var(--text3)" }}>PRO #: </span>
                      <strong>{response.proNumber}</strong>
                    </div>
                  )}
                  {response.carrierPickupDate && (
                    <div style={{ fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: "var(--text3)" }}>Carrier Pickup Date: </span>
                      <strong>{response.carrierPickupDate}</strong>
                    </div>
                  )}
                  {response.pickupEta && (
                    <div style={{ fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: "var(--text3)" }}>Est. Pickup: </span>
                      <strong>{response.pickupEta.replace("T", " ")}</strong>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 12, color: "var(--red)", fontWeight: 600, marginBottom: 4 }}>
                  {response.reason}
                </div>
              )}
              {response.notes && (
                <div style={{ fontSize: 12, color: "var(--text2)", fontStyle: "italic", marginTop: 4 }}>
                  "{response.notes}"
                </div>
              )}
              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 8 }}>
                Responded {response.respondedAt}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={() => { onClose(); onRespond(shipment.id); }}>
            {response ? "Change Response" : "Respond to Tender"}
          </button>
        </div>
      </div>
    </div>
  );
}
