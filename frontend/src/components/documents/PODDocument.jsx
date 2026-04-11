const gridLabel = { display: "grid", gridTemplateColumns: "100px 1fr", fontSize: 11, lineHeight: 2 };

export default function PODDocument({ doc, shipment }) {
  const s = shipment || {};

  return (
    <div style={{ border: "2px solid #000", fontSize: 12, color: "#000", background: "#fff" }}>
      {/* Header */}
      <div style={{ padding: 16, borderBottom: "2px solid #000", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: 2 }}>ZOREE TMS</div>
          <div style={{ fontSize: 14, fontWeight: 800, marginTop: 4, letterSpacing: 1 }}>PROOF OF DELIVERY</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "#666" }}>POD Number</div>
          <div style={{ fontSize: 16, fontWeight: 900, fontFamily: "monospace", color: "#1e2d6b" }}>{doc.id}</div>
          <div style={{ fontSize: 10, color: "#666", marginTop: 6 }}>Delivery Date: {s.delivery}</div>
        </div>
      </div>

      {/* Details */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: "2px solid #000" }}>
        <div style={{ padding: "14px 16px", borderRight: "2px solid #000" }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", marginBottom: 8 }}>Shipment Details</div>
          <div style={gridLabel}>
            <span style={{ color: "#666" }}>Shipment:</span>
            <span className="mono" style={{ fontWeight: 700 }}>{s.id}</span>
            <span style={{ color: "#666" }}>BOL #:</span>
            <span className="mono">{doc.id.replace("POD", "BOL")}</span>
            <span style={{ color: "#666" }}>Carrier:</span>
            <span>{s.carrier}</span>
            <span style={{ color: "#666" }}>Origin:</span>
            <span>{s.origin}</span>
            <span style={{ color: "#666" }}>Destination:</span>
            <span>{s.dest}</span>
            <span style={{ color: "#666" }}>Commodity:</span>
            <span>{s.commodity}</span>
            <span style={{ color: "#666" }}>Weight:</span>
            <span className="mono">{s.weight} lbs</span>
            <span style={{ color: "#666" }}>Pieces:</span>
            <span>{s.pieces}</span>
          </div>
        </div>
        <div style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", marginBottom: 8 }}>Delivery Confirmation</div>
          <div style={{ padding: 12, background: "#e8f5e9", border: "1px solid #4caf50", borderRadius: 6, marginBottom: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: "#2e7d32" }}>DELIVERED</div>
            <div style={{ fontSize: 11, color: "#444", marginTop: 4 }}>Delivered on: {s.delivery}</div>
          </div>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", marginBottom: 6 }}>Condition of Goods</div>
          <div style={{ fontSize: 11, display: "flex", gap: 16 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <input type="radio" name="pod-cond" defaultChecked /> Good Order
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <input type="radio" name="pod-cond" /> Exception
            </label>
          </div>
        </div>
      </div>

      {/* Signatures */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", padding: "20px 16px", gap: 24 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginBottom: 28 }}>Receiver Signature</div>
          <div style={{ borderBottom: "1px solid #000", marginBottom: 6, height: 32 }}></div>
          <div style={{ fontSize: 10, color: "#666" }}>Print Name / Date / Time</div>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>Notes / Exceptions</div>
          <div style={{ border: "1px solid #ccc", height: 72, padding: 8, fontSize: 11, color: "#aaa" }}>
            Enter any exceptions or notes here
          </div>
        </div>
      </div>
    </div>
  );
}
