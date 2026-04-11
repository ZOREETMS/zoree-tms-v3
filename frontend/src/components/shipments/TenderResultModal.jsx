import { useState, useEffect } from "react";

/**
 * Tender result modal — shows sending animation, then success/failure.
 * Matches old HTML modal-tender-result.
 */
export default function TenderResultModal({ isOpen, shipment, result, onClose, onViewShipment }) {
  const [phase, setPhase] = useState("sending"); // sending | success | error

  useEffect(() => {
    if (isOpen && result) {
      // Show sending for 1.5s, then show result
      setPhase("sending");
      const timer = setTimeout(() => {
        setPhase(result.error ? "error" : "success");
      }, 1500);
      return () => clearTimeout(timer);
    }
    if (isOpen && !result) {
      setPhase("sending");
    }
  }, [isOpen, result]);

  if (!isOpen || !shipment) return null;

  const origin = (shipment.origin || "").split(",")[0];
  const dest = (shipment.dest || shipment.destination || "").split(",")[0];
  const carrier = shipment._carrier || shipment.carrier || "—";
  const refNum = result?.refNum || "—";

  const heroStyle = {
    sending: { background: "linear-gradient(135deg,#1a237e,#3b82f6)" },
    success: { background: "linear-gradient(135deg,#0f4c35,#16a34a)" },
    error: { background: "linear-gradient(135deg,#7f1d1d,#dc2626)" },
  };
  const icons = { sending: "📡", success: "✅", error: "⚠️" };
  const titles = {
    sending: "Sending Tender…",
    success: "Tender Sent Successfully",
    error: "Tender Failed",
  };
  const subs = {
    sending: `${carrier} · ${origin} → ${dest}`,
    success: result?.emailSent ? `Email sent to ${result.to || carrier}` : `Tendered to ${carrier} (no email configured)`,
    error: result?.errorMessage || "Failed to send tender",
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(10,15,40,.82)", backdropFilter: "blur(8px)",
        zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={phase !== "sending" ? onClose : undefined}
    >
      <div
        style={{
          width: 560, maxWidth: "92vw", borderRadius: 24, overflow: "hidden",
          boxShadow: "0 32px 80px rgba(0,0,0,.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hero */}
        <div style={{ padding: "40px 40px 32px", textAlign: "center", position: "relative", ...heroStyle[phase] }}>
          <button
            onClick={onClose}
            style={{
              position: "absolute", top: 16, right: 18,
              background: "rgba(255,255,255,.15)", border: "none", color: "#fff",
              width: 30, height: 30, borderRadius: "50%", fontSize: 16,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ✕
          </button>
          <div style={{ fontSize: 72, lineHeight: 1, marginBottom: 16, filter: "drop-shadow(0 4px 12px rgba(0,0,0,.2))" }}>
            {icons[phase]}
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#fff", marginBottom: 6, fontFamily: "'Syne',sans-serif", letterSpacing: "-.3px" }}>
            {titles[phase]}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,.75)", fontWeight: 500 }}>
            {subs[phase]}
          </div>
        </div>

        {/* Pulse bar */}
        <div style={{ height: 4, background: "rgba(255,255,255,.15)", overflow: "hidden" }}>
          <div style={{
            height: "100%",
            width: phase === "sending" ? "80%" : "100%",
            background: phase === "error" ? "#dc2626" : "#fff",
            transition: "width 1.2s ease",
            opacity: 0.7,
          }} />
        </div>

        {/* Body */}
        <div style={{ padding: "24px 32px", background: "#fff" }}>
          {/* Shipment summary card */}
          <div style={{ background: "#f4f7ff", border: "1.5px solid #e0e8ff", borderRadius: 14, padding: "16px 20px", marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div>
                <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: "var(--accent)" }}>{shipment.id}</div>
                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{carrier} · {shipment.mode || "LTL"}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: "var(--green)" }}>
                  ${Number(shipment.total_cost || 0).toLocaleString()}
                </div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 11 }}>
              <div>
                <div style={{ color: "var(--text3)", fontWeight: 600, marginBottom: 2 }}>ORIGIN</div>
                <div style={{ fontWeight: 600 }}>{origin}</div>
              </div>
              <div>
                <div style={{ color: "var(--text3)", fontWeight: 600, marginBottom: 2 }}>DESTINATION</div>
                <div style={{ fontWeight: 600 }}>{dest}</div>
              </div>
              <div>
                <div style={{ color: "var(--text3)", fontWeight: 600, marginBottom: 2 }}>PICKUP</div>
                <div className="mono" style={{ fontWeight: 600 }}>{shipment.pickup_date || "—"}</div>
              </div>
            </div>
          </div>

          {/* Confirmation ref (success only) */}
          {phase === "success" && (
            <div style={{
              background: "linear-gradient(135deg,rgba(16,185,129,.06),rgba(16,185,129,.12))",
              border: "1.5px solid rgba(16,185,129,.3)", borderRadius: 14,
              padding: "16px 20px", marginBottom: 20,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 40, height: 40, background: "var(--green)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
                  📋
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>
                    Confirmation Reference
                  </div>
                  <div className="mono" style={{ fontSize: 18, fontWeight: 900, color: "#1d4ed8", letterSpacing: 1 }}>
                    {refNum}
                  </div>
                </div>
                <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--text3)", textAlign: "right" }}>
                  Keep this for<br />your records
                </div>
              </div>
            </div>
          )}

          {/* Error box */}
          {phase === "error" && (
            <div style={{
              background: "rgba(239,68,68,.05)", border: "1.5px solid rgba(239,68,68,.25)",
              borderRadius: 14, padding: "16px 20px", marginBottom: 20,
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ width: 40, height: 40, background: "var(--red)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
                  ⚠️
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--red)", marginBottom: 4 }}>Tender Failed</div>
                  <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>{result?.errorMessage || "Unknown error"}</div>
                </div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={onClose} style={{ flex: 1, minWidth: 100, padding: 12, background: "#f0f4ff", color: "var(--text2)", border: "1.5px solid var(--border2)", borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              Close
            </button>
            <button onClick={() => { onClose(); if (onViewShipment) onViewShipment(shipment.id); }} style={{ flex: 2, minWidth: 160, padding: 12, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              📦 View Shipment
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
