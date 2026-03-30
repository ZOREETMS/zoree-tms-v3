export default function BidDetailModal({ rfq, onAward, onClose }) {
  if (!rfq) return null;

  const best = rfq.responses.length
    ? rfq.responses.reduce((a, r) =>
        parseFloat(r.rate) < parseFloat(a.rate) ? r : a,
        rfq.responses[0]
      )
    : null;

  return (
    <div className="modal-overlay open">
      <div className="modal" style={{ width: 580 }}>
        {/* Header */}
        <div
          className="modal-header"
          style={{
            background: "linear-gradient(135deg,#1e2d6b,#7c3aed)",
            borderRadius: "16px 16px 0 0",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,.6)",
                textTransform: "uppercase",
                letterSpacing: 1,
                marginBottom: 4,
              }}
            >
              Carrier Bid Comparison
            </div>
            <span className="modal-title" style={{ color: "#fff" }}>
              Bids — {rfq.id}
            </span>
          </div>
          <button
            className="modal-close"
            onClick={onClose}
            style={{ color: "rgba(255,255,255,.7)", fontSize: 22 }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
            {rfq.id} — {rfq.lane}
          </div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 16 }}>
            {rfq.volume} loads/mo · Deadline: {rfq.deadline}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rfq.responses.map((r) => {
              const isBest = best && r.carrier === best.carrier;
              return (
                <div
                  key={r.carrier}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "12px 16px",
                    background: isBest ? "var(--green-dim)" : "#f8faff",
                    border: `2px solid ${isBest ? "var(--green)" : "var(--border)"}`,
                    borderRadius: 10,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{r.carrier}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                      OTD Score: {r.score}
                    </div>
                  </div>
                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: 15,
                      color: isBest ? "var(--green)" : "var(--text)",
                    }}
                  >
                    {r.rate}
                  </div>
                  {isBest && (
                    <span
                      style={{
                        fontSize: 10,
                        background: "var(--green)",
                        color: "#fff",
                        padding: "3px 9px",
                        borderRadius: 20,
                        fontWeight: 700,
                      }}
                    >
                      BEST BID
                    </span>
                  )}
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => onAward(rfq.id, r.carrier)}
                  >
                    Award
                  </button>
                </div>
              );
            })}
          </div>

          {rfq.responses.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--text3)", padding: 24 }}>
              No bid responses for this RFQ
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
